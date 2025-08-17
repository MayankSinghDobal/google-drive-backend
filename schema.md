# Database Schema for Google Drive Clone

This file defines the database schema for the Google Drive clone project, including tables for users, files, folders, and permissions. Designed for PostgreSQL (via Supabase).

## Users Table
Stores user information for authentication.
- `id`: INTEGER (Primary Key, Auto-increment)
- `email`: TEXT (Unique, Not Null)
- `password`: TEXT (Hashed, Not Null)
- `name`: TEXT (Optional)
- `created_at`: TIMESTAMP (Default: NOW())

## Files Table
Stores metadata for files (actual files stored in Supabase Storage).
- `id`: INTEGER (Primary Key, Auto-increment)
- `name`: TEXT (Not Null, e.g., "resume.pdf")
- `size`: INTEGER (Not Null, in bytes)
- `format`: TEXT (Not Null, e.g., "pdf", "jpg")
- `path`: TEXT (Not Null, storage path in Supabase, e.g., "/user1/resume.pdf")
- `user_id`: INTEGER (Foreign Key -> Users.id, Not Null)
- `folder_id`: INTEGER (Foreign Key -> Folders.id, Nullable for root-level files)
- `created_at`: TIMESTAMP (Default: NOW())
- `deleted_at`: TIMESTAMP (Nullable, for soft delete/Trash feature)

## Folders Table
Stores folder structure and hierarchy.
- `id`: INTEGER (Primary Key, Auto-increment)
- `name`: TEXT (Not Null, e.g., "My Documents")
- `parent_folder_id`: INTEGER (Foreign Key -> Folders.id, Nullable for root folders)
- `user_id`: INTEGER (Foreign Key -> Users.id, Not Null)
- `created_at`: TIMESTAMP (Default: NOW())
- `deleted_at`: TIMESTAMP (Nullable, for soft delete/Trash feature)

## Permissions Table
Stores sharing and permission settings for files and folders.
- `id`: INTEGER (Primary Key, Auto-increment)
- `file_id`: INTEGER (Foreign Key -> Files.id, Nullable if permission is for a folder)
- `folder_id`: INTEGER (Foreign Key -> Folders.id, Nullable if permission is for a file)
- `user_id`: INTEGER (Foreign Key -> Users.id, Nullable for public links)
- `role`: TEXT (Not Null, e.g., "view", "edit", "owner")
- `share_link`: TEXT (Nullable, unique shareable link for public access)
- `created_at`: TIMESTAMP (Default: NOW())