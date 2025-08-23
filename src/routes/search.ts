import express, { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateJWT } from '../middleware/auth';

const router: Router = express.Router();

// Search files and folders route with pagination
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { query, page = '1', limit = '10' } = req.query;

  // Validate input
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ error: 'Invalid page or limit parameter' });
  }

  const offset = (pageNum - 1) * limitNum;

  try {
    // Clean query to prevent SQL injection
    const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (!cleanQuery) {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    // Search files with pagination
    const { data: files, error: filesError, count: filesCount } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, folder_id, created_at', { count: 'exact' })
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .textSearch('name', cleanQuery, { type: 'websearch' })
      .range(offset, offset + limitNum - 1);

    if (filesError) {
      throw filesError;
    }

    // Search folders with pagination
    const { data: folders, error: foldersError, count: foldersCount } = await supabase
      .from('folders')
      .select('id, name, user_id, parent_id, created_at', { count: 'exact' })
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .textSearch('name', cleanQuery, { type: 'websearch' })
      .range(offset, offset + limitNum - 1);

    if (foldersError) {
      throw foldersError;
    }

    // Add public URLs to files
    const filesWithUrls = files.map((file) => ({
      ...file,
      type: 'file',
      publicUrl: supabase.storage.from('drive-files').getPublicUrl(file.path).data.publicUrl,
    }));

    // Add type to folders
    const foldersWithType = folders.map((folder) => ({
      ...folder,
      type: 'folder',
    }));

    // Combine and sort results by name
    const results = [...filesWithUrls, ...foldersWithType].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Calculate pagination metadata
    const totalItems = (filesCount || 0) + (foldersCount || 0);
    const totalPages = Math.ceil(totalItems / limitNum);

    res.status(200).json({
      message: 'Search completed successfully',
      results,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Search failed: ${errorMessage}` });
  }
});

export default router;