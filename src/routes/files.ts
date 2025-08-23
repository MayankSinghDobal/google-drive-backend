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

// File retrieval route
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };

  try {
    const { data, error } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, created_at')
      .eq('user_id', user.userId)
      .is('deleted_at', null); // Exclude soft-deleted files

    if (error) {
      throw error;
    }

    // Add public URLs to each file
    const filesWithUrls = data.map((file) => ({
      ...file,
      publicUrl: supabase.storage.from('drive-files').getPublicUrl(file.path).data.publicUrl,
    }));

    res.status(200).json({ message: 'Files retrieved successfully', files: filesWithUrls });
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
    // Check if file exists and belongs to the user
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, user_id')
      .eq('id', fileId)
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
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
    // Check if file exists and belongs to the user
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, user_id')
      .eq('id', fileId)
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
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
    // Check if file exists and belongs to the user
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, user_id, path')
      .eq('id', fileId)
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
    }

    // Generate unique share token
    const shareToken = uuidv4();

    // Insert permission into Supabase
    const { data: permission, error: permissionError } = await supabase
      .from('permissions')
      .insert({
        file_id: fileId,
        user_id: null, // Null for public links
        role,
        share_token: shareToken,
      })
      .select('id, file_id, role, share_token')
      .single();

    if (permissionError) {
      throw permissionError;
    }

    // Generate shareable link
    const shareableLink = `http://localhost:3000/files/share/${shareToken}`;

    res.status(201).json({
      message: 'File shared successfully',
      permission,
      shareableLink,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `File sharing failed: ${errorMessage}` });
  }
});

export default router;