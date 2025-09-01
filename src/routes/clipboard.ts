import express from "express";
import { supabase } from "../config/supabase";
import { authenticateJWT } from "../middleware/auth";

// Extend Express Request to include custom User type
declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

interface User {
  id: number;
  email: string;
  name: string;
}

const router = express.Router();

// Copy/Cut (add to clipboard)
router.post('/:operation/:itemType/:itemId', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { operation, itemType, itemId } = req.params;
  if (!['copy', 'cut'].includes(operation) || !['file', 'folder'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid operation or type' });
  }
  await supabase.from("user_clipboard").delete().eq("user_id", req.user.id); // Clear existing
  const { error } = await supabase.from("user_clipboard").insert({
    user_id: req.user.id,
    item_id: parseInt(itemId),
    item_type: itemType,
    operation,
  });
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: `${operation} added to clipboard` });
});

// Paste
router.post('/paste/:folderId?', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { folderId } = req.params;
  const { data: clipboard, error: clipboardError } = await supabase
    .from("user_clipboard")
    .select("*")
    .eq("user_id", req.user.id)
    .single();
  if (clipboardError || !clipboard) {
    return res.status(404).json({ error: 'Clipboard empty' });
  }
  let updates = { folder_id: folderId ? parseInt(folderId) : null };
  if (clipboard.item_type === 'file') {
    if (clipboard.operation === 'cut') {
      await supabase.from("files").update(updates).eq("id", clipboard.item_id);
    } else { // Copy: duplicate file
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select("id, name, size, format, path, user_id, folder_id")
        .eq("id", clipboard.item_id)
        .single();
      if (fileError || !file) {
        return res.status(404).json({ error: 'File not found' });
      }
      await supabase.from("files").insert({
        ...file,
        name: `${file.name} (copy)`,
        folder_id: updates.folder_id,
      });
    }
  } else { // Folder
    if (clipboard.operation === 'cut') {
      await supabase.from("folders").update({ parent_id: updates.folder_id }).eq("id", clipboard.item_id);
    } else { // Copy: recursive copy (simplified)
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id, name, user_id, parent_id")
        .eq("id", clipboard.item_id)
        .single();
      if (folderError || !folder) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      await supabase.from("folders").insert({
        ...folder,
        name: `${folder.name} (copy)`,
        parent_id: updates.folder_id,
      });
    }
  }
  if (clipboard.operation === 'cut') {
    await supabase.from("user_clipboard").delete().eq("id", clipboard.id);
  }
  res.json({ message: 'Pasted successfully' });
});

export default router;