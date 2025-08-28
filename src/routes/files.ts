import express, { Router, Request, Response } from "express";
import multer from "multer";
import { supabase } from "../config/supabase";
import { authenticateJWT } from "../middleware/auth";
import { v4 as uuidv4 } from "uuid";

const router: Router = express.Router();

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Log activity helper function
async function logActivity(
  userId: number | null,
  fileId: number,
  action: string,
  details: object
) {
  try {
    const { error } = await supabase.from("activity_logs").insert({
      user_id: userId,
      file_id: fileId,
      action,
      details,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`Failed to log activity: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `Error logging activity: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

// Validation helper functions
function isValidFileId(fileId: string): boolean {
  return /^[0-9]+$/.test(fileId);
}

function isValidShareToken(token: string): boolean {
  return /^[a-fA-F0-9-]+$/.test(token);
}

// File upload route
router.post(
  "/upload",
  authenticateJWT,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const user = req.user as { userId: number; email: string };
    const file = req.file;
    const fileName = `${user.userId}/${Date.now()}_${file.originalname}`;
    const filePath = `drive_files/${fileName}`;
    const versionPath = `drive_files/versions/${user.userId}/${Date.now()}_${
      file.originalname
    }`;

    try {
      // Start a transaction
      const { data: fileData, error: fileError } = await supabase
        .from("files")
        .insert({
          name: file.originalname,
          size: file.size,
          format: file.mimetype,
          path: filePath,
          user_id: user.userId,
          folder_id: null, // Root-level file for now
        })
        .select("id, name, size, format, path, user_id")
        .single();

      if (fileError) {
        throw fileError;
      }

      // Upload file to Supabase Storage (main file)
      const { error: storageError } = await supabase.storage
        .from("drive_files")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (storageError) {
        // Rollback: delete file metadata
        await supabase.from("files").delete().eq("id", fileData.id);
        throw storageError;
      }

      // Upload file to Supabase Storage (version)
      const { error: versionStorageError } = await supabase.storage
        .from("drive_files")
        .upload(versionPath, file.buffer, {
          contentType: file.mimetype,
        });

      if (versionStorageError) {
        // Rollback: delete main file and metadata
        await supabase.storage.from("drive_files").remove([fileName]);
        await supabase.from("files").delete().eq("id", fileData.id);
        throw versionStorageError;
      }

      // Assign 'owner' role to the uploader
      const { error: permissionError } = await supabase
        .from("permissions")
        .insert({
          file_id: fileData.id,
          user_id: user.userId,
          role: "owner",
          share_token: uuidv4(),
        });

      if (permissionError) {
        // Rollback: delete files and metadata
        await supabase.storage
          .from("drive_files")
          .remove([fileName, versionPath]);
        await supabase.from("files").delete().eq("id", fileData.id);
        throw permissionError;
      }

      // Store version in file_versions
      const { error: versionError } = await supabase
        .from("file_versions")
        .insert({
          file_id: fileData.id,
          version_number: 1,
          name: file.originalname,
          size: file.size,
          format: file.mimetype,
          path: versionPath,
          created_by: user.userId,
        });

      if (versionError) {
        // Rollback: delete files, metadata, and permission
        await supabase.storage
          .from("drive_files")
          .remove([fileName, versionPath]);
        await supabase.from("files").delete().eq("id", fileData.id);
        await supabase.from("permissions").delete().eq("file_id", fileData.id);
        throw versionError;
      }

      // Log upload action
      await logActivity(user.userId, fileData.id, "upload", {
        file_name: file.originalname,
        size: file.size,
        format: file.mimetype,
      });

      // Get public URL for the main file
      const { data: urlData } = supabase.storage
        .from("drive_files")
        .getPublicUrl(fileName);

      res.status(201).json({
        message: "File uploaded successfully",
        file: fileData,
        publicUrl: urlData.publicUrl,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `File upload failed: ${errorMessage}` });
    }
  }
);

// File retrieval route with pagination
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { page = "1", limit = "10" } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  if (
    isNaN(pageNum) ||
    pageNum < 1 ||
    isNaN(limitNum) ||
    limitNum < 1 ||
    limitNum > 100
  ) {
    return res.status(400).json({ error: "Invalid page or limit parameter" });
  }

  const offset = (pageNum - 1) * limitNum;

  try {
    const { data, error, count } = await supabase
      .from("files")
      .select("id, name, size, format, path, user_id, created_at", {
        count: "exact",
      })
      .eq("user_id", user.userId)
      .is("deleted_at", null)
      .range(offset, offset + limitNum - 1);

    if (error) {
      throw error;
    }

    // Add public URLs to each file
    const filesWithUrls = data.map((file) => ({
      ...file,
      publicUrl: supabase.storage.from("drive_files").getPublicUrl(file.path)
        .data.publicUrl,
    }));

    // Calculate pagination metadata
    const totalItems = count || 0;
    const totalPages = Math.ceil(totalItems / limitNum);

    res.status(200).json({
      message: "Files retrieved successfully",
      files: filesWithUrls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `File retrieval failed: ${errorMessage}` });
  }
});

// Soft delete file route
router.delete(
  "/:fileId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as { userId: number; email: string };
    const { fileId } = req.params;

    // Validate fileId
    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    try {
      // Check if file exists and user has 'owner' role
      const { data: permission, error: permissionError } = await supabase
        .from("permissions")
        .select("id")
        .eq("file_id", fileId)
        .eq("user_id", user.userId)
        .eq("role", "owner")
        .single();

      if (permissionError || !permission) {
        return res
          .status(403)
          .json({ error: "Unauthorized: Only the owner can delete this file" });
      }

      // Fetch file name for logging
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select("name")
        .eq("id", fileId)
        .single();

      if (fileError || !file) {
        return res.status(404).json({ error: "File not found" });
      }

      // Soft delete by setting deleted_at
      const { error: deleteError } = await supabase
        .from("files")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", fileId);

      if (deleteError) {
        throw deleteError;
      }

      // Log delete action
      await logActivity(user.userId, parseInt(fileId), "delete", {
        file_name: file.name,
      });

      res.status(200).json({ message: "File soft deleted successfully" });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `File deletion failed: ${errorMessage}` });
    }
  }
);

// Update file route
router.patch(
  "/:fileId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as { userId: number; email: string };
    const { fileId } = req.params;
    const { name, folder_id } = req.body;

    // Validate fileId
    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    // Validate input
    if (!name && !folder_id) {
      return res
        .status(400)
        .json({ error: "At least one of name or folder_id is required" });
    }

    try {
      // Check if file exists and user has 'owner' role
      const { data: permission, error: permissionError } = await supabase
        .from("permissions")
        .select("id")
        .eq("file_id", fileId)
        .eq("user_id", user.userId)
        .eq("role", "owner")
        .single();

      if (permissionError || !permission) {
        return res
          .status(403)
          .json({ error: "Unauthorized: Only the owner can update this file" });
      }

      // If folder_id is provided, verify it exists and belongs to the user
      if (folder_id) {
        const { data: folder, error: folderError } = await supabase
          .from("folders")
          .select("id, user_id")
          .eq("id", folder_id)
          .eq("user_id", user.userId)
          .is("deleted_at", null)
          .single();

        if (folderError || !folder) {
          return res
            .status(404)
            .json({ error: "Folder not found or unauthorized" });
        }
      }

      // Fetch current file name for logging
      const { data: currentFile, error: fileError } = await supabase
        .from("files")
        .select("name")
        .eq("id", fileId)
        .single();

      if (fileError || !currentFile) {
        return res.status(404).json({ error: "File not found" });
      }

      // Update file
      const updates: { name?: string; folder_id?: number | null } = {};
      if (name) updates.name = name;
      if (folder_id !== undefined) updates.folder_id = folder_id || null;

      const { data, error } = await supabase
        .from("files")
        .update(updates)
        .eq("id", fileId)
        .select("id, name, size, format, path, user_id, folder_id, created_at")
        .single();

      if (error) {
        throw error;
      }

      // Log update action
      await logActivity(user.userId, parseInt(fileId), "update", {
        old_name: currentFile.name,
        new_name: name || currentFile.name,
        folder_id: folder_id || null,
      });

      // Get public URL for the updated file
      const { data: urlData } = supabase.storage
        .from("drive_files")
        .getPublicUrl(data.path);

      res.status(200).json({
        message: "File updated successfully",
        file: { ...data, publicUrl: urlData.publicUrl },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `File update failed: ${errorMessage}` });
    }
  }
);

// Share file route
router.post(
  "/:fileId/share",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as { userId: number; email: string };
    const { fileId } = req.params;
    const { role } = req.body;

    // Validate fileId
    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    // Validate input
    if (!role || !["view", "edit"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Valid role (view or edit) is required" });
    }

    try {
      // Check if file exists and user has 'owner' role
      const { data: permission, error: permissionError } = await supabase
        .from("permissions")
        .select("id")
        .eq("file_id", fileId)
        .eq("user_id", user.userId)
        .eq("role", "owner")
        .single();

      if (permissionError || !permission) {
        return res
          .status(403)
          .json({ error: "Unauthorized: Only the owner can share this file" });
      }

      // Fetch file name for logging
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select("name")
        .eq("id", fileId)
        .single();

      if (fileError || !file) {
        return res.status(404).json({ error: "File not found" });
      }

      // Generate unique share token
      const shareToken = uuidv4();

      // Insert permission into Supabase
      const { data: newPermission, error: insertError } = await supabase
        .from("permissions")
        .insert({
          file_id: fileId,
          user_id: null, // Null for public links
          role,
          share_token: shareToken,
        })
        .select("id, file_id, role, share_token")
        .single();

      if (insertError) {
        throw insertError;
      }

      // Log share action
      await logActivity(user.userId, parseInt(fileId), "share", {
        file_name: file.name,
        role,
        share_token: shareToken,
      });

      // Generate shareable link - use proper base URL
      const baseUrl =
        process.env.NODE_ENV === "production"
          ? "https://google-drive-backend-ten.vercel.app"
          : process.env.BASE_URL || "http://localhost:3000";

      const shareableLink = `${baseUrl}/files/share/${shareToken}`;

      res.status(201).json({
        message: "File shared successfully",
        permission: newPermission,
        shareableLink,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `File sharing failed: ${errorMessage}` });
    }
  }
);

// Access shared file route
router.get("/share/:shareToken", async (req: Request, res: Response) => {
  const { shareToken } = req.params;

  // Validate shareToken
  if (!isValidShareToken(shareToken)) {
    return res.status(400).json({ error: "Invalid share token format" });
  }

  try {
    // Check if permission exists and file is not deleted
    const { data: permission, error: permissionError } = await supabase
      .from("permissions")
      .select("file_id, role")
      .eq("share_token", shareToken)
      .single();

    if (permissionError || !permission) {
      return res.status(404).json({ error: "Invalid or expired share link" });
    }

    // Fetch file details
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, name, size, format, path, user_id, folder_id, created_at")
      .eq("id", permission.file_id)
      .is("deleted_at", null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: "File not found or deleted" });
    }

    // Generate signed URL (expires in 1 hour)
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("drive_files")
        .createSignedUrl(file.path, 3600); // 3600 seconds = 1 hour

    if (signedUrlError) {
      throw signedUrlError;
    }

    // Return metadata with signed URL
    return res.status(200).json({
      message: "Shared file retrieved successfully",
      file: { ...file, signedUrl: signedUrlData.signedUrl },
      role: permission.role,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res
      .status(500)
      .json({ error: `Shared file access failed: ${errorMessage}` });
  }
});

// Edit shared file route (REMOVED SOCKET.IO BROADCASTING)
router.patch("/share/:shareToken", async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  const { name } = req.body;

  // Validate shareToken
  if (!isValidShareToken(shareToken)) {
    return res.status(400).json({ error: "Invalid share token format" });
  }

  // Validate input
  if (!name) {
    return res.status(400).json({ error: "New file name is required" });
  }

  try {
    // Check if permission exists and is 'edit'
    const { data: permission, error: permissionError } = await supabase
      .from("permissions")
      .select("file_id, role")
      .eq("share_token", shareToken)
      .eq("role", "edit")
      .single();

    if (permissionError || !permission) {
      return res
        .status(403)
        .json({ error: "Invalid share link or insufficient permissions" });
    }

    // Fetch file details
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, name, size, format, path, user_id, folder_id, created_at")
      .eq("id", permission.file_id)
      .is("deleted_at", null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: "File not found or deleted" });
    }

    // Get current version number
    const { data: lastVersion, error: versionError } = await supabase
      .from("file_versions")
      .select("version_number")
      .eq("file_id", file.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    const nextVersionNumber = lastVersion ? lastVersion.version_number + 1 : 1;

    // Download current file for versioning
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("drive_files")
      .download(file.path);

    if (downloadError || !fileData) {
      throw new Error(
        `Failed to download file for versioning: ${
          downloadError?.message || "File data not found"
        }`
      );
    }

    // Store version in file_versions
    const versionPath = `drive_files/versions/${
      file.user_id
    }/${Date.now()}_${name}`;
    const { error: versionStorageError } = await supabase.storage
      .from("drive_files")
      .upload(versionPath, fileData, { contentType: file.format });

    if (versionStorageError) {
      throw versionStorageError;
    }

    const { error: versionInsertError } = await supabase
      .from("file_versions")
      .insert({
        file_id: file.id,
        version_number: nextVersionNumber,
        name: file.name,
        size: file.size,
        format: file.format,
        path: versionPath,
        created_by: null, // Null for shared link edits
      });

    if (versionInsertError) {
      await supabase.storage.from("drive_files").remove([versionPath]);
      throw versionInsertError;
    }

    // Update file name
    const { data: updatedFile, error: updateError } = await supabase
      .from("files")
      .update({ name })
      .eq("id", file.id)
      .select("id, name, size, format, path, user_id, folder_id, created_at")
      .single();

    if (updateError) {
      // Rollback: delete version
      await supabase.storage.from("drive_files").remove([versionPath]);
      await supabase
        .from("file_versions")
        .delete()
        .eq("file_id", file.id)
        .eq("version_number", nextVersionNumber);
      throw updateError;
    }

    // Log edit action
    await logActivity(null, file.id, "edit", {
      old_name: file.name,
      new_name: name,
      share_token: shareToken,
    });

    // NOTE: Socket.IO broadcasting removed for Vercel compatibility
    // Real-time updates would need to be implemented differently (e.g., webhooks, polling)

    // Generate signed URL for updated file
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("drive_files")
        .createSignedUrl(file.path, 3600);

    if (signedUrlError) {
      throw signedUrlError;
    }

    res.status(200).json({
      message: "Shared file updated successfully",
      file: { ...updatedFile, signedUrl: signedUrlData.signedUrl },
      role: permission.role,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res
      .status(500)
      .json({ error: `Shared file update failed: ${errorMessage}` });
  }
});

// Subscribe to file updates (SIMPLIFIED WITHOUT WEBSOCKETS)
router.get(
  "/:fileId/subscribe",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as { userId: number; email: string };
    const { fileId } = req.params;

    // Validate fileId
    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    try {
      // Check if file exists and user has access (owner or shared permission)
      const { data: permission, error: permissionError } = await supabase
        .from("permissions")
        .select("id, role")
        .eq("file_id", fileId)
        .or(`user_id.eq.${user.userId},role.in.(view,edit)`)
        .single();

      if (permissionError || !permission) {
        return res
          .status(403)
          .json({ error: "Unauthorized: No access to this file" });
      }

      // Fetch file details

      const { data: file, error: fileError } = await supabase

        .from("files")

        .select("id, name, user_id")

        .eq("id", fileId)

        .is("deleted_at", null)

        .single();

      if (fileError || !file) {
        return res.status(404).json({ error: "File not found or deleted" });
      }

      res.status(200).json({
        message: "Subscribed to file updates",

        file_id: fileId,

        instructions:
          'Connect to WebSocket at ws://localhost:3000 and emit "join_file" with fileId',
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      res.status(500).json({ error: `Subscription failed: ${errorMessage}` });
    }
  }
);

// Get file versions route - REMOVED REGEX PATTERN

router.get(
  "/:fileId/versions",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as { userId: number; email: string };

    const { fileId } = req.params;

    // Validate fileId

    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    try {
      // Check if file exists and user has 'owner' role

      const { data: permission, error: permissionError } = await supabase

        .from("permissions")

        .select("id")

        .eq("file_id", fileId)

        .eq("user_id", user.userId)

        .eq("role", "owner")

        .single();

      if (permissionError || !permission) {
        return res.status(403).json({
          error: "Unauthorized: Only the owner can view version history",
        });
      }

      // Fetch file details

      const { data: file, error: fileError } = await supabase

        .from("files")

        .select("id, user_id")

        .eq("id", fileId)

        .is("deleted_at", null)

        .single();

      if (fileError || !file) {
        return res.status(404).json({ error: "File not found or deleted" });
      }

      // Fetch version history

      const { data: versions, error: versionsError } = await supabase

        .from("file_versions")

        .select(
          "id, version_number, name, size, format, path, created_at, created_by"
        )

        .eq("file_id", fileId)

        .order("version_number", { ascending: true });

      if (versionsError) {
        throw versionsError;
      }

      // Add signed URLs to versions

      const versionsWithUrls = await Promise.all(
        versions.map(async (version) => {
          const { data: signedUrlData, error: signedUrlError } =
            await supabase.storage

              .from("drive_files")

              .createSignedUrl(version.path, 3600);

          return {
            ...version,

            signedUrl: signedUrlError ? null : signedUrlData.signedUrl,
          };
        })
      );

      res.status(200).json({
        message: "File versions retrieved successfully",

        versions: versionsWithUrls,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      res
        .status(500)
        .json({ error: `Version retrieval failed: ${errorMessage}` });
    }
  }
);
router.get("/with-folders", authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { page = "1", limit = "50" } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ error: "Invalid page or limit parameter" });
  }

  try {
    // Get files
    const { data: files, error: filesError } = await supabase
      .from("files")
      .select("id, name, size, format, path, user_id, folder_id, created_at")
      .eq("user_id", user.userId)
      .is("deleted_at", null)
      .limit(limitNum);

    if (filesError) throw filesError;

    // Get folders
    const { data: folders, error: foldersError } = await supabase
      .from("folders")
      .select("id, name, user_id, parent_id, created_at")
      .eq("user_id", user.userId)
      .is("deleted_at", null)
      .limit(limitNum);

    if (foldersError) throw foldersError;

    // Add public URLs to files and type information
    const filesWithUrls = files.map((file) => ({
      ...file,
      type: 'file' as const,
      publicUrl: supabase.storage.from("drive_files").getPublicUrl(file.path).data.publicUrl,
    }));

    const foldersWithType = folders.map((folder) => ({
      ...folder,
      type: 'folder' as const,
    }));

    // Combine files and folders
    const allItems = [...filesWithUrls, ...foldersWithType];

    res.status(200).json({
      message: "Files and folders retrieved successfully",
      files: allItems, // Keep the same structure your frontend expects
      folders: foldersWithType, // Also provide folders separately
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Data retrieval failed: ${errorMessage}` });
  }
});
export default router;
