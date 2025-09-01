import express, { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateJWT } from '../middleware/auth';

const router: Router = express.Router();

// Create folder route
router.post('/create', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  const { name, parent_id } = req.body;

  // Basic input validation
  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    // If parent_id is provided, verify it exists and belongs to the user
    if (parent_id) {
      const { data: parentFolder, error: parentError } = await supabase
        .from('folders')
        .select('id, user_id')
        .eq('id', parent_id)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .single();

      if (parentError || !parentFolder) {
        return res.status(404).json({ error: 'Parent folder not found or unauthorized' });
      }
    }

    // Insert new folder into Supabase
    const { data, error } = await supabase
      .from('folders')
      .insert({
        name,
        user_id: user.id,
        parent_id: parent_id || null,
      })
      .select('id, name, user_id, parent_id, created_at')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({ message: 'Folder created successfully', folder: data });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Folder creation failed: ${errorMessage}` });
  }
});

// Folder retrieval route with pagination
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  const { page = '1', limit = '10' } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ error: 'Invalid page or limit parameter' });
  }

  const offset = (pageNum - 1) * limitNum;

  try {
    const { data, error, count } = await supabase
      .from('folders')
      .select('id, name, user_id, parent_id, created_at', { count: 'exact' })
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .range(offset, offset + limitNum - 1);

    if (error) {
      throw error;
    }

    // Calculate pagination metadata
    const totalItems = count || 0;
    const totalPages = Math.ceil(totalItems / limitNum);

    res.status(200).json({
      message: 'Folders retrieved successfully',
      folders: data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Folder retrieval failed: ${errorMessage}` });
  }
});

// Soft delete folder route
router.delete('/:folderId', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  const { folderId } = req.params;

  try {
    // Check if folder exists and belongs to the user
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('id, user_id')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (folderError || !folder) {
      return res.status(404).json({ error: 'Folder not found or unauthorized' });
    }

    // Check if folder has subfolders or files
    const { data: subfolders, error: subfolderError } = await supabase
      .from('folders')
      .select('id')
      .eq('parent_id', folderId)
      .is('deleted_at', null);

    if (subfolderError) {
      throw subfolderError;
    }

    const { data: files, error: fileError } = await supabase
      .from('files')
      .select('id')
      .eq('folder_id', folderId)
      .is('deleted_at', null);

    if (fileError) {
      throw fileError;
    }

    if (subfolders?.length || files?.length) {
      return res.status(400).json({ error: 'Cannot delete folder with subfolders or files' });
    }

    // Soft delete by setting deleted_at
    const { error: deleteError } = await supabase
      .from('folders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', folderId);

    if (deleteError) {
      throw deleteError;
    }

    res.status(200).json({ message: 'Folder soft deleted successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Folder deletion failed: ${errorMessage}` });
  }
});

// Update folder route
router.patch('/:folderId', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as any;
    if (!user || (!user.id && typeof user.id !== 'number')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  const { folderId } = req.params;
  const { name, parent_id } = req.body;

  // Validate input
  if (!name && !parent_id) {
    return res.status(400).json({ error: 'At least one of name or parent_id is required' });
  }

  try {
    // Check if folder exists and belongs to the user
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('id, user_id')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (folderError || !folder) {
      return res.status(404).json({ error: 'Folder not found or unauthorized' });
    }

    // If parent_id is provided, verify it exists, belongs to the user, and isn't the same folder
    if (parent_id) {
      if (parseInt(folderId) === parseInt(parent_id)) {
        return res.status(400).json({ error: 'Folder cannot be its own parent' });
      }

      const { data: parentFolder, error: parentError } = await supabase
        .from('folders')
        .select('id, user_id')
        .eq('id', parent_id)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .single();

      if (parentError || !parentFolder) {
        return res.status(404).json({ error: 'Parent folder not found or unauthorized' });
      }
    }

    // Update folder
    const updates: { name?: string; parent_id?: number | null } = {};
    if (name) updates.name = name;
    if (parent_id !== undefined) updates.parent_id = parent_id || null;

    const { data, error } = await supabase
      .from('folders')
      .update(updates)
      .eq('id', folderId)
      .select('id, name, user_id, parent_id, created_at')
      .single();

    if (error) {
      throw error;
    }

    res.status(200).json({ message: 'Folder updated successfully', folder: data });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Folder update failed: ${errorMessage}` });
  }
});

export default router;