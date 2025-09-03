import express, { Router, Request, Response } from "express";
import multer from "multer";
import { supabase } from "../config/supabase";
import { authenticateJWT } from "../middleware/auth";
import { v4 as uuidv4 } from "uuid";
import path from 'path';

const router: Router = express.Router();

// Enhanced file type validation - Support ALL common file types
const allowedMimeTypes = [
  // Images
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
  
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  
  // Text files
  'text/plain', 'text/html', 'text/css', 'text/javascript', 'text/typescript',
  'text/markdown', 'text/csv', 'text/xml', 'application/json',
  'application/javascript', 'application/typescript',
  
  // Archives
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/x-rar',
  'application/x-7z-compressed', 'application/gzip',
  'application/x-tar', 'application/x-bzip2',
  
  // Audio
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac',
  'audio/flac', 'audio/wma', 'audio/m4a',
  
  // Video
  'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv',
  'video/webm', 'video/mkv', 'video/m4v', 'video/3gp',
  'video/quicktime', 'video/x-msvideo',
  
  // Code files
  'text/x-python', 'text/x-java', 'text/x-csharp', 'text/x-php',
  'text/x-ruby', 'text/x-go', 'text/x-rust', 'text/x-kotlin',
  'application/x-python-code',
  
  // Others
  'application/octet-stream', 'application/x-executable',
  'application/vnd.android.package-archive', // APK files
  'application/x-deb', // DEB packages
  'application/x-rpm', // RPM packages
];

const dangerousExtensions = [
  '.exe', '.bat', '.cmd', '.scr', '.pif', '.com', '.msi', 
  '.dll', '.sys', '.vbs', '.js', '.jar'
];

// Configure Multer for file uploads with enhanced validation
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // Increased to 500MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    // Check for dangerous executable types
    if (dangerousExtensions.includes(fileExt)) {
      cb(new Error('Executable files are not allowed for security reasons'));
      return;
    }
    
    // If MIME type is not in our list, but it's not dangerous, allow it
    const isDangerous = dangerousExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (isDangerous) {
      cb(new Error('File type not allowed for security reasons'));
      return;
    }
    
    // Accept all non-dangerous files
    cb(null, true);
  }
});
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
  // UUID v4 format check - share tokens should be UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(token);
}

// Enhanced file upload route
router.post(
  "/upload",
  authenticateJWT,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const file = req.file;
    console.log(`Uploading file: ${file.originalname}, MIME: ${file.mimetype}, Size: ${file.size}`);
    
    // Get folder_id from request body
    let folderId: number | null = null;
    if (req.body.folder_id) {
      folderId = parseInt(req.body.folder_id);
      if (isNaN(folderId)) {
        return res.status(400).json({ error: "Invalid folder ID" });
      }
      
      // Verify folder exists and belongs to user
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id, user_id")
        .eq("id", folderId)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .single();

      if (folderError || !folder) {
        return res.status(404).json({ error: "Folder not found or unauthorized" });
      }
    }

    // Generate unique file paths
    const timestamp = Date.now();
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${user.id}/${timestamp}_${sanitizedFileName}`;
    const filePath = fileName;
    const versionPath = `versions/${user.id}/${timestamp}_${sanitizedFileName}`;

    try {
      // Insert file metadata first
      const { data: fileData, error: fileError } = await supabase
        .from("files")
        .insert({
          name: file.originalname,
          size: file.size,
          format: file.mimetype || 'application/octet-stream',
          path: filePath,
          user_id: user.id,
          folder_id: folderId,
          is_public: false,
          visibility: 'private'
        })
        .select("id, name, size, format, path, user_id, folder_id")
        .single();

      if (fileError) {
        console.error('Database insert error:', fileError);
        throw fileError;
      }

      console.log('File metadata saved:', fileData);

      // Upload file to Supabase Storage (main file)
      const { error: storageError } = await supabase.storage
        .from("drive_files")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: false
        });

      if (storageError) {
        console.error('Storage upload error:', storageError);
        // Rollback: delete file metadata
        await supabase.from("files").delete().eq("id", fileData.id);
        throw storageError;
      }

      console.log('File uploaded to storage successfully');

      // Upload file to versions folder
      const { error: versionStorageError } = await supabase.storage
        .from("drive_files")
        .upload(versionPath, file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: false
        });

      if (versionStorageError) {
        console.warn('Version upload failed (non-critical):', versionStorageError);
      }

      // Create owner permission
      const { error: permissionError } = await supabase
        .from("permissions")
        .insert({
          file_id: fileData.id,
          user_id: user.id,
          role: "owner",
          share_token: uuidv4(),
        });

      if (permissionError) {
        console.error('Permission creation error:', permissionError);
        // Rollback: delete files and metadata
        await supabase.storage.from("drive_files").remove([filePath]);
        if (!versionStorageError) {
          await supabase.storage.from("drive_files").remove([versionPath]);
        }
        await supabase.from("files").delete().eq("id", fileData.id);
        throw permissionError;
      }

      // Store version in file_versions (only if version upload succeeded)
      if (!versionStorageError) {
        const { error: versionError } = await supabase
          .from("file_versions")
          .insert({
            file_id: fileData.id,
            version_number: 1,
            name: file.originalname,
            size: file.size,
            format: file.mimetype || 'application/octet-stream',
            path: versionPath,
            created_by: user.id,
          });

        if (versionError) {
          console.warn('Version metadata save failed (non-critical):', versionError);
        }
      }

      // Log upload action
      await logActivity(user.id, fileData.id, "upload", {
        file_name: file.originalname,
        size: file.size,
        format: file.mimetype,
        folder_id: folderId,
      });

      // Get public URL for the main file
      const { data: urlData } = supabase.storage
        .from("drive_files")
        .getPublicUrl(filePath);

      console.log('Upload completed successfully');

      res.status(201).json({
        message: "File uploaded successfully",
        file: { 
          ...fileData, 
          publicUrl: urlData.publicUrl,
          type: 'file'
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error('Upload failed:', errorMessage);
      res.status(500).json({ error: `File upload failed: ${errorMessage}` });
    }
  }
);

// Enhanced download route with proper file streaming
router.get(
  "/:fileId/download",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { fileId } = req.params;

    if (!isValidFileId(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format" });
    }

    try {
      // Check if user has access to the file
      const { data: permission, error: permissionError } = await supabase
        .from("permissions")
        .select("id, role, can_download")
        .eq("file_id", fileId)
        .eq("user_id", user.id)
        .single();

      if (permissionError && permissionError.code !== "PGRST116") {
        console.error("Permission check error:", permissionError);
        return res.status(403).json({ error: "Unauthorized: No access to this file" });
      }

      if (!permission || permission.can_download === false) {
        return res.status(403).json({ error: "Unauthorized: Download not allowed" });
      }

      // Fetch file details
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select("id, name, path, size, format")
        .eq("id", fileId)
        .is("deleted_at", null)
        .single();

      if (fileError || !file) {
        return res.status(404).json({ error: "File not found" });
      }

      // Download file from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("drive_files")
        .download(file.path);

      if (downloadError || !fileData) {
        console.error("Storage download error:", downloadError);
        return res.status(500).json({ error: "Failed to download file from storage" });
      }

      // Log download action
      await logActivity(user.id, parseInt(fileId), "download", {
        file_name: file.name,
        file_size: file.size,
        file_format: file.format,
      });

      // Set proper headers for file download
      // Set proper headers for file download
const contentType = file.format || 'application/octet-stream';
const fileExtension = path.extname(file.name).toLowerCase();

// Map common extensions to correct MIME types if format is wrong
const mimeTypeMap: { [key: string]: string } = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', 
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

const finalContentType = mimeTypeMap[fileExtension] || contentType;

res.setHeader('Content-Type', finalContentType);
res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
res.setHeader('Content-Length', file.size.toString());
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Accept-Ranges', 'bytes');

      // Convert blob to buffer and send
      const buffer = await fileData.arrayBuffer();
      res.send(Buffer.from(buffer));

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Download failed:", errorMessage);
      res.status(500).json({ error: `Download failed: ${errorMessage}` });
    }
  }
);

// File retrieval route with pagination
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
  if (!user || (!user.id && typeof user.id !== 'number')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
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
      .eq("user_id", user.id)
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

// Get files and folders with enhanced data
router.get("/with-folders", authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
  if (!user || (!user.id && typeof user.id !== 'number')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
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
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(limitNum);

    if (filesError) throw filesError;

    // Get folders
    const { data: folders, error: foldersError } = await supabase
      .from("folders")
      .select("id, name, user_id, parent_id, created_at")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(limitNum);

    if (foldersError) throw foldersError;

    // Enhanced files with URLs and metadata
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
      files: allItems,
      folders: foldersWithType,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Data retrieval failed: ${errorMessage}` });
  }
});

// Soft delete file route
router.delete(
  "/:fileId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
        .eq("user_id", user.id)
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
      await logActivity(user.id, parseInt(fileId), "delete", {
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
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
        .eq("user_id", user.id)
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
          .eq("user_id", user.id)
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
      await logActivity(user.id, parseInt(fileId), "update", {
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

// Enhanced share file route with granular permissions
router.post(
  "/:fileId/share",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== "number")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { fileId } = req.params;
    const {
      role,
      can_download = true,
      can_preview = true,
      expires_at = null,
      max_access_count = null,
    } = req.body;

    if (!role || !["view", "edit"].includes(role)) {
      return res.status(400).json({ error: "Valid role (view or edit) is required" });
    }

    try {
      // Ensure caller is owner of file (adapt if your logic differs)
      const { data: ownerPermission, error: ownerErr } = await supabase
        .from("permissions")
        .select("id")
        .eq("file_id", fileId)
        .eq("user_id", user.id)
        .eq("role", "owner")
        .single();

      if (ownerErr || !ownerPermission) {
        return res.status(403).json({ error: "Unauthorized: Only the owner can share this file" });
      }

      // Verify file exists (for logging)
      const { data: fileRow, error: fileErr } = await supabase
        .from("files")
        .select("id, name")
        .eq("id", fileId)
        .single();

      if (fileErr || !fileRow) {
        return res.status(404).json({ error: "File not found" });
      }

      const shareToken = uuidv4();

      const { data: newPermission, error: insertError } = await supabase
        .from("permissions")
        .insert({
          file_id: fileId,
          user_id: null,
          role,
          share_token: shareToken,
          can_download,
          can_preview,
          expires_at: expires_at ? new Date(expires_at).toISOString() : null,
          max_access_count,
          access_count: 0,
        })
        .select("id, file_id, role, share_token, can_download, can_preview, expires_at, max_access_count")
        .single();

      if (insertError) throw insertError;

      await logActivity(user.id, parseInt(fileId), "share", {
        file_name: fileRow.name,
        share_token: shareToken,
        permissions: { can_download, can_preview, expires_at, max_access_count },
      });

      const baseUrl =
        process.env.NODE_ENV === "production"
          ? process.env.FRONTEND_PROD_URL || "https://your-production-frontend.example"
          : process.env.FRONTEND_URL || "http://localhost:5173";

      const shareableLink = `${baseUrl}/share/${shareToken}`;

      return res.status(201).json({
        message: "File shared successfully",
        permission: newPermission,
        shareableLink,
        token: shareToken,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("POST share error:", err);
      return res.status(500).json({ error: `File sharing failed: ${message}` });
    }
  }
);


// Clipboard operations - Copy/Cut
router.post('/:operation/:itemType/:itemId', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { operation, itemType, itemId } = req.params;
  const user = req.user as any;
  
  if (!['copy', 'cut'].includes(operation) || !['file', 'folder'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid operation or type' });
  }

  try {
    // Validate that the item exists and user has access
    if (itemType === 'file') {
      const { data: file, error } = await supabase
        .from('files')
        .select('id, name, user_id')
        .eq('id', parseInt(itemId))
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .single();
      
      if (error || !file) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }
    } else {
      const { data: folder, error } = await supabase
        .from('folders')
        .select('id, name, user_id')
        .eq('id', parseInt(itemId))
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .single();
      
      if (error || !folder) {
        return res.status(404).json({ error: 'Folder not found or access denied' });
      }
    }

    // Clear existing clipboard items for this user
    await supabase.from("user_clipboard").delete().eq("user_id", user.id);
    
    // Add to clipboard
    const { error } = await supabase.from("user_clipboard").insert({
      user_id: user.id,
      item_id: parseInt(itemId),
      item_type: itemType,
      operation,
    });
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ message: `${itemType} ${operation} operation added to clipboard` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Paste operation
router.post('/paste/:folderId?', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { folderId } = req.params;
  const user = req.user as any;
  
  try {
    // Get clipboard contents
    const { data: clipboard, error: clipboardError } = await supabase
      .from("user_clipboard")
      .select("*")
      .eq("user_id", user.id)
      .single();
    
    if (clipboardError || !clipboard) {
      return res.status(404).json({ error: 'Clipboard empty' });
    }

    // Validate target folder if provided
    if (folderId) {
      const { data: targetFolder, error: folderError } = await supabase
        .from("folders")
        .select("id, user_id")
        .eq("id", parseInt(folderId))
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .single();
      
      if (folderError || !targetFolder) {
        return res.status(404).json({ error: 'Target folder not found or access denied' });
      }
    }

    const targetFolderId = folderId ? parseInt(folderId) : null;

    if (clipboard.item_type === 'file') {
      if (clipboard.operation === 'cut') {
        // Move file
        const { data: updatedFile, error: moveError } = await supabase
          .from("files")
          .update({ folder_id: targetFolderId })
          .eq("id", clipboard.item_id)
          .eq("user_id", user.id)
          .select("*")
          .single();
        
        if (moveError) {
          return res.status(500).json({ error: 'Failed to move file' });
        }
        
        // Clear clipboard after cut
        await supabase.from("user_clipboard").delete().eq("id", clipboard.id);
        
        // Log activity
        await logActivity(user.id, clipboard.item_id, "move", {
          operation: "cut_paste",
          target_folder_id: targetFolderId,
        });
        
        res.json({ 
          message: 'File moved successfully',
          file: updatedFile 
        });
      } else {
        // Copy file
        const { data: originalFile, error: fileError } = await supabase
          .from("files")
          .select("*")
          .eq("id", clipboard.item_id)
          .eq("user_id", user.id)
          .single();
        
        if (fileError || !originalFile) {
          return res.status(404).json({ error: 'Original file not found' });
        }

        // Download original file
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("drive_files")
          .download(originalFile.path);

        if (downloadError || !fileData) {
          return res.status(500).json({ error: 'Failed to copy file data' });
        }

        // Create new file path
        const timestamp = Date.now();
        const sanitizedFileName = originalFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const copyName = `${originalFile.name.replace(/\.[^/.]+$/, "")} - Copy${path.extname(originalFile.name)}`;
        const newPath = `${user.id}/${timestamp}_${sanitizedFileName}`;

        // Upload copied file
        const { error: uploadError } = await supabase.storage
          .from("drive_files")
          .upload(newPath, fileData, {
            contentType: originalFile.format,
          });

        if (uploadError) {
          return res.status(500).json({ error: 'Failed to upload copied file' });
        }

        // Create new file record
        const { data: newFile, error: createError } = await supabase
          .from("files")
          .insert({
            name: copyName,
            size: originalFile.size,
            format: originalFile.format,
            path: newPath,
            user_id: user.id,
            folder_id: targetFolderId,
            is_public: false,
            visibility: 'private'
          })
          .select("*")
          .single();

        if (createError) {
          // Cleanup uploaded file
          await supabase.storage.from("drive_files").remove([newPath]);
          return res.status(500).json({ error: 'Failed to create file record' });
        }

        // Create owner permission for new file
        await supabase.from("permissions").insert({
          file_id: newFile.id,
          user_id: user.id,
          role: "owner",
          share_token: uuidv4(),
        });

        // Log activity
        await logActivity(user.id, newFile.id, "copy", {
          operation: "copy_paste",
          original_file_id: clipboard.item_id,
          target_folder_id: targetFolderId,
        });

        res.json({ 
          message: 'File copied successfully',
          file: newFile 
        });
      }
    } else {
      // Handle folder operations
      if (clipboard.operation === 'cut') {
        // Move folder
        const { data: updatedFolder, error: moveError } = await supabase
          .from("folders")
          .update({ parent_id: targetFolderId })
          .eq("id", clipboard.item_id)
          .eq("user_id", user.id)
          .select("*")
          .single();
        
        if (moveError) {
          return res.status(500).json({ error: 'Failed to move folder' });
        }
        
        // Clear clipboard after cut
        await supabase.from("user_clipboard").delete().eq("id", clipboard.id);
        
        // Log activity
        await logActivity(user.id, clipboard.item_id, "move_folder", {
          operation: "cut_paste",
          target_folder_id: targetFolderId,
        });
        
        res.json({ 
          message: 'Folder moved successfully',
          folder: updatedFolder 
        });
      } else {
        // Copy folder (simplified - only copies folder, not contents)
        const { data: originalFolder, error: folderError } = await supabase
          .from("folders")
          .select("*")
          .eq("id", clipboard.item_id)
          .eq("user_id", user.id)
          .single();
        
        if (folderError || !originalFolder) {
          return res.status(404).json({ error: 'Original folder not found' });
        }

        const copyName = `${originalFolder.name} - Copy`;

        // Create new folder record
        const { data: newFolder, error: createError } = await supabase
          .from("folders")
          .insert({
            name: copyName,
            user_id: user.id,
            parent_id: targetFolderId,
          })
          .select("*")
          .single();

        if (createError) {
          return res.status(500).json({ error: 'Failed to create folder copy' });
        }

        // Log activity
        await logActivity(user.id, newFolder.id, "copy_folder", {
          operation: "copy_paste",
          original_folder_id: clipboard.item_id,
          target_folder_id: targetFolderId,
        });

        res.json({ 
          message: 'Folder copied successfully',
          folder: newFolder 
        });
      }
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Subscribe to file updates (SIMPLIFIED WITHOUT WEBSOCKETS)
router.get(
  "/:fileId/subscribe",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
        .or(`user_id.eq.${user.id},role.in.(view,edit)`)
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

// Get file versions route
router.get(
  "/:fileId/versions",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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
        .eq("user_id", user.id)
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

export default router;