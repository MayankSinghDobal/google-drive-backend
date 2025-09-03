import express, { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";

const router: Router = express.Router();

// Enhanced access shared file route with permission validation
router.get("/:shareToken", async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  console.log(`GET /share/${shareToken} called`);

  if (!shareToken) return res.status(400).json({ error: "Missing share token" });

  try {
    const { data: permission, error: permErr } = await supabase
      .from("permissions")
      .select("file_id, role, can_download, can_preview, expires_at, max_access_count, access_count")
      .eq("share_token", shareToken)
      .single();

    if (permErr || !permission) {
      console.log("Share token not found:", shareToken);
      return res.status(404).json({ error: "Invalid or expired share link" });
    }

    if (permission.expires_at && new Date() > new Date(permission.expires_at)) {
      return res.status(403).json({ error: "Share link has expired" });
    }

    if (permission.max_access_count && permission.access_count >= permission.max_access_count) {
      return res.status(403).json({ error: "Share link access limit reached" });
    }

    const { data: file, error: fileErr } = await supabase
      .from("files")
      .select("id, name, size, format, path, user_id, folder_id, created_at")
      .eq("id", permission.file_id)
      .is("deleted_at", null)
      .single();

    if (fileErr || !file) {
      console.log("File referenced by permission not found:", permission.file_id);
      return res.status(404).json({ error: "File not found or deleted" });
    }

    // Increment access count (best-effort)
    await supabase
      .from("permissions")
      .update({ access_count: permission.access_count + 1 })
      .eq("share_token", shareToken);

    // Try to build a public URL only if preview allowed and storage returns one
    let publicUrl: string | null = null;
    if (permission.can_preview && file.path) {
      try {
        // supabase.storage.from(...).getPublicUrl returns { data: { publicUrl } }
        const { data: urlData } = await supabase.storage.from("drive_files").getPublicUrl(file.path);
        publicUrl = urlData?.publicUrl ?? null;
      } catch (e) {
        console.warn("getPublicUrl failed for", file.path, e);
      }
    }

    return res.status(200).json({
      message: "Shared file retrieved successfully",
      file: { ...file, publicUrl },
      permissions: {
        role: permission.role,
        can_download: permission.can_download,
        can_preview: permission.can_preview,
        expires_at: permission.expires_at,
        access_count: (permission.access_count ?? 0) + 1,
        max_access_count: permission.max_access_count,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GET /share error:", err);
    return res.status(500).json({ error: `Failed to fetch shared file: ${message}` });
  }
});

// Enhanced shared file download route
router.get("/:shareToken/download", async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  if (!shareToken) return res.status(400).json({ error: "Missing share token" });

  try {
    const { data: permission, error: permErr } = await supabase
      .from("permissions")
      .select("file_id, can_download, expires_at, max_access_count, access_count")
      .eq("share_token", shareToken)
      .single();

    if (permErr || !permission) return res.status(404).json({ error: "Invalid or expired share link" });
    if (!permission.can_download) return res.status(403).json({ error: "Download not allowed for this share link" });
    if (permission.expires_at && new Date() > new Date(permission.expires_at)) return res.status(403).json({ error: "Share link has expired" });
    if (permission.max_access_count && permission.access_count >= permission.max_access_count) return res.status(403).json({ error: "Share link access limit reached" });

    const { data: file, error: fileErr } = await supabase
      .from("files")
      .select("id, name, path, size, format")
      .eq("id", permission.file_id)
      .is("deleted_at", null)
      .single();

    if (fileErr || !file) return res.status(404).json({ error: "File not found or deleted" });

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("drive_files")
      .download(file.path);

    if (downloadError || !fileData) {
      console.error("Storage download error:", downloadError);
      return res.status(500).json({ error: "Failed to download file from storage" });
    }

    // Update access count
    await supabase.from("permissions").update({ access_count: permission.access_count + 1 }).eq("share_token", shareToken);

    // Send file with proper headers
    res.setHeader("Content-Type", file.format || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
    if (file.size) res.setHeader("Content-Length", file.size.toString());
    res.setHeader("Cache-Control", "no-cache");

    const arrayBuf = await fileData.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Download share error:", err);
    return res.status(500).json({ error: `Download failed: ${message}` });
  }
});

export default router;