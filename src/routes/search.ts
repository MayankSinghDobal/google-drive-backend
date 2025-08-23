import express, { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateJWT } from '../middleware/auth';

const router: Router = express.Router();

// Search files and folders route
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user as { userId: number; email: string };
  const { query } = req.query;

  // Validate input
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    // Clean query to prevent SQL injection
    const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (!cleanQuery) {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    // Search files using full-text search
    const { data: files, error: filesError } = await supabase
      .from('files')
      .select('id, name, size, format, path, user_id, folder_id, created_at')
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .textSearch('name', cleanQuery, { type: 'websearch' });

    if (filesError) {
      throw filesError;
    }

    // Search folders using full-text search
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('id, name, user_id, parent_id, created_at')
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .textSearch('name', cleanQuery, { type: 'websearch' });

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

    res.status(200).json({
      message: 'Search completed successfully',
      results,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Search failed: ${errorMessage}` });
  }
});

export default router;