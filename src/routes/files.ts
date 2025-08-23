import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase';
import { authenticateJWT } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router: Router = express.Router();

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// File upload route
router.post('/upload', authenticateJWT, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const user = req.user as { userId: number; email: string };
  const file = req.file;
  const fileName = `${user.userId}/${Date.now()}_${file.originalname}`;
  const filePath = `drive-files/${fileName}`;

  try {
    // Upload file to Supabase Storage
    const { data: storageData, error: storageError } = await supabase.storage
      .from('drive-files')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });

    if (storageError) {
      throw storageError;
    }

    // Get public URL for the file
    const { data: urlData } = supabase.storage.from('drive-files').getPublicUrl(fileName);

    // Store metadata in Supabase database
    const { data: fileData, error: dbError } = await supabase
      .from('files')
      .insert({
        name: file.originalname,
        size: file.size,
        format: file.mimetype,
        path: filePath,
        user_id: user.userId,
        folder_id: null, // Root-level file for now
      })
      .select('id, name, size, format, path, user_id')
      .single();

    if (dbError) {
      // If database insert fails, remove the uploaded file
      await supabase.storage.from('drive-files').remove([fileName]);
      throw dbError;
    }

    // Assign 'owner' role to the uploader
    const { error: permissionError } = await supabase
      .from('permissions')
      .insert({
        file_id: fileData.id,
        user_id: user.userId,
        role: 'owner',
        share_token: uuidv4(), // Unique token for owner
      });

    if (permissionError) {
      // If permission insert fails, remove the uploaded file and metadata
      await supabase.storage.from('drive-files').remove([fileName]);
      await supabase.from('files').delete().eq('id', fileData.id);
      throw permissionError;
    }

    res.status(201).json({
      message: 'File uploaded successfully',
      file: fileData,
      publicUrl: urlData.publicUrl,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File upload failed: ${errorMessage}` });
  }
});

router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { page = '1', limit = '10' } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ error: 'Invalid page or limit parameter' });
  }

  const offset = (pageNum - 1) * limitNum;

  try {
    const { data, error, count } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, created_at', { count: 'exact' })
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .range(offset, offset + limitNum - 1);

    if (error) {
      throw error;
    }

    // Add public URLs to each file
    const filesWithUrls = data.map((file) => ({
      ...file,
      publicUrl: supabase.storage.from('drive-files').getPublicUrl(file.path).data.publicUrl,
    }));

    // Calculate pagination metadata
    const totalItems = count || 0;
    const totalPages = Math.ceil(totalItems / limitNum);

    res.status(200).json({
      message: 'Files retrieved successfully',
      files: filesWithUrls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File retrieval failed: ${errorMessage}` });
  }
});

// Soft delete file route
router.delete('/:fileId', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { fileId } = req.params;

  try {
    // Check if file exists and user has 'owner' role
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('id')
      .eq('file_id', fileId)
      .eq('user_id', user.userId)
      .eq('role', 'owner')
      .single();

    if (permissionError || !permission) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can delete this file' });
    }

    // Soft delete by setting deleted_at
    const { error: deleteError } = await supabase
      .from('files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fileId);

    if (deleteError) {
      throw deleteError;
    }

    res.status(200).json({ message: 'File soft deleted successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File deletion failed: ${errorMessage}` });
  }
});

// Update file route
router.patch('/:fileId', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { fileId } = req.params;
  const { name, folder_id } = req.body;

  // Validate input
  if (!name && !folder_id) {
    return res.status(400).json({ error: 'At least one of name or folder_id is required' });
  }

  try {
    // Check if file exists and user has 'owner' role
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('id')
      .eq('file_id', fileId)
      .eq('user_id', user.userId)
      .eq('role', 'owner')
      .single();

    if (permissionError || !permission) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can update this file' });
    }

    // If folder_id is provided, verify it exists and belongs to the user
    if (folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from('folders')
        .select('id, user_id')
        .eq('id', folder_id)
        .eq('user_id', user.userId)
        .is('deleted_at', null)
        .single();

      if (folderError || !folder) {
        return res.status(404).json({ error: 'Folder not found or unauthorized' });
      }
    }

    // Update file
    const updates: { name?: string; folder_id?: number | null } = {};
    if (name) updates.name = name;
    if (folder_id !== undefined) updates.folder_id = folder_id || null;

    const { data, error } = await supabase
      .from('files')
      .update(updates)
      .eq('id', fileId)
      .select('id, name, size, format, path, user_id, folder_id, created_at')
      .single();

    if (error) {
      throw error;
    }

    // Get public URL for the updated file
    const { data: urlData } = supabase.storage.from('drive-files').getPublicUrl(data.path);

    res.status(200).json({
      message: 'File updated successfully',
      file: { ...data, publicUrl: urlData.publicUrl },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File update failed: ${errorMessage}` });
  }
});

// Share file route
router.post('/:fileId/share', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { fileId } = req.params;
  const { role } = req.body;

  // Validate input
  if (!role || !['view', 'edit'].includes(role)) {
    return res.status(400).json({ error: 'Valid role (view or edit) is required' });
  }

  try {
    // Check if file exists and user has 'owner' role
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('id')
      .eq('file_id', fileId)
      .eq('user_id', user.userId)
      .eq('role', 'owner')
      .single();

    if (permissionError || !permission) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can share this file' });
    }

    // Generate unique share token
    const shareToken = uuidv4();

    // Insert permission into Supabase
    const { data: newPermission, error: insertError } = await supabase
      .from('permissions')
      .insert({
        file_id: fileId,
        user_id: null, // Null for public links
        role,
        share_token: shareToken,
      })
      .select('id, file_id, role, share_token')
      .single();

    if (insertError) {
      throw insertError;
    }

    // Generate shareable link
    const shareableLink = `http://localhost:3000/files/share/${shareToken}`;

    res.status(201).json({
      message: 'File shared successfully',
      permission: newPermission,
      shareableLink,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File sharing failed: ${errorMessage}` });
  }
});

// Access shared file route
router.get('/share/:shareToken', async (req: Request, res: Response) => {
  const { shareToken } = req.params;

  try {
    // Check if permission exists and file is not deleted
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('file_id, role')
      .eq('share_token', shareToken)
      .single();

    if (permissionError || !permission) {
      return res.status(404).json({ error: 'Invalid or expired share link' });
    }

    // Fetch file details
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, folder_id, created_at')
      .eq('id', permission.file_id)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: 'File not found or deleted' });
    }

    // Generate signed URL (expires in 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('drive-files')
      .createSignedUrl(file.path, 3600); // 3600 seconds = 1 hour

    if (signedUrlError) {
      throw signedUrlError;
    }

    // Return metadata with signed URL
    return res.status(200).json({
      message: 'Shared file retrieved successfully',
      file: { ...file, signedUrl: signedUrlData.signedUrl },
      role: permission.role,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Shared file access failed: ${errorMessage}` });
  }
});

// Edit shared file route
router.patch('/share/:shareToken', async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  const { name } = req.body;

  // Validate input
  if (!name) {
    return res.status(400).json({ error: 'New file name is required' });
  }

  try {
    // Check if permission exists and is 'edit'
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .select('file_id, role')
      .eq('share_token', shareToken)
      .eq('role', 'edit')
      .single();

    if (permissionError || !permission) {
      return res.status(403).json({ error: 'Invalid share link or insufficient permissions' });
    }

    // Fetch file details
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, folder_id, created_at')
      .eq('id', permission.file_id)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: 'File not found or deleted' });
    }

    // Update file name
    const { data: updatedFile, error: updateError } = await supabase
      .from('files')
      .update({ name })
      .eq('id', file.id)
      .select('id, name, size, format, path, user_id, folder_id, created_at')
      .single();

    if (updateError) {
      throw updateError;
    }

    // Generate signed URL for updated file
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('drive-files')
      .createSignedUrl(file.path, 3600);

    if (signedUrlError) {
      throw signedUrlError;
    }

    res.status(200).json({
      message: 'Shared file updated successfully',
      file: { ...updatedFile, signedUrl: signedUrlData.signedUrl },
      role: permission.role,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Shared file update failed: ${errorMessage}` });
  }
});

export default router;