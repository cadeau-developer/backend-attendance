-- Allow a super admin to block an approved school and unblock it later.
ALTER TYPE "SchoolStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
