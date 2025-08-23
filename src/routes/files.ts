import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase';
import { authenticateJWT } from '../middleware/auth';

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

export default router;