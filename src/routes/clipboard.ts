import express from "express";
import { supabase } from "../config/supabase";
import { authenticateJWT } from "../middleware/auth";
import { v4 as uuidv4 } from "uuid";
import path from 'path';

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

// Log activity helper function
async function logActivity(
  userId: number | null,
  fileId: number | null,
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

// Copy/Cut (add to clipboard)
router.post('/:operation/:itemType/:itemId', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { operation, itemType, itemId } = req.params;
  const user = req.user as User;
  
  if (!['copy', 'cut'].includes(operation) || !['file', 'folder'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid operation or type' });
  }

  try {
    // Validate that the item exists and user has access
    let itemName = '';
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
      itemName = file.name;
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
      itemName = folder.name;
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

    // Log activity
    await logActivity(user.id, itemType === 'file' ? parseInt(itemId) : null, `clipboard_${operation}`, {
      item_type: itemType,
      item_name: itemName,
      operation: operation
    });
    
    res.json({ 
      message: `${itemName} ${operation} operation added to clipboard`,
      operation: operation,
      itemType: itemType,
      itemName: itemName
    });
  } catch (error: any) {
    console.error('Clipboard operation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get clipboard contents
router.get('/contents', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = req.user as User;

  try {
    const { data: clipboard, error } = await supabase
      .from("user_clipboard")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get item details
    const enrichedClipboard = await Promise.all(
      clipboard.map(async (item) => {
        let itemDetails = null;
        
        if (item.item_type === 'file') {
          const { data: file } = await supabase
            .from('files')
            .select('name, format, size')
            .eq('id', item.item_id)
            .single();
          itemDetails = file;
        } else {
          const { data: folder } = await supabase
            .from('folders')
            .select('name')
            .eq('id', item.item_id)
            .single();
          itemDetails = folder;
        }

        return {
          ...item,
          itemDetails
        };
      })
    );

    res.json({
      message: 'Clipboard contents retrieved',
      clipboard: enrichedClipboard
    });
  } catch (error: any) {
    console.error('Get clipboard contents failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Paste
router.post('/paste/:folderId?', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { folderId } = req.params;
  const user = req.user as User;
  
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
    let resultMessage = '';
    let resultItem = null;

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
          file_name: updatedFile.name
        });
        
        resultMessage = 'File moved successfully';
        resultItem = { ...updatedFile, type: 'file' };
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
        const fileExt = path.extname(originalFile.name);
        const fileName = path.basename(originalFile.name, fileExt);
        const copyName = `${fileName} - Copy${fileExt}`;
        const sanitizedFileName = copyName.replace(/[^a-zA-Z0-9.-]/g, '_');
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
          file_name: copyName
        });

        resultMessage = 'File copied successfully';
        resultItem = { ...newFile, type: 'file' };
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
        
        // Log activity (using null for file_id since this is a folder)
        await logActivity(user.id, null, "move_folder", {
          operation: "cut_paste",
          folder_id: clipboard.item_id,
          target_folder_id: targetFolderId,
          folder_name: updatedFolder.name
        });
        
        resultMessage = 'Folder moved successfully';
        resultItem = { ...updatedFolder, type: 'folder' };
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

        // Log activity (using null for file_id since this is a folder)
        await logActivity(user.id, null, "copy_folder", {
          operation: "copy_paste",
          original_folder_id: clipboard.item_id,
          folder_id: newFolder.id,
          target_folder_id: targetFolderId,
          folder_name: copyName
        });

        resultMessage = 'Folder copied successfully';
        resultItem = { ...newFolder, type: 'folder' };
      }
    }

    res.json({ 
      message: resultMessage,
      item: resultItem,
      operation: clipboard.operation
    });
  } catch (error: any) {
    console.error('Paste operation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear clipboard
router.delete('/clear', authenticateJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = req.user as User;

  try {
    const { error } = await supabase
      .from("user_clipboard")
      .delete()
      .eq("user_id", user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Clipboard cleared successfully' });
  } catch (error: any) {
    console.error('Clear clipboard failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;