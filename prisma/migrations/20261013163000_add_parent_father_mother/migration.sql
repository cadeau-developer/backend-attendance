-- Add separate father and mother contact fields to Student.
ALTER TABLE "Student" ADD COLUMN "fatherName" TEXT,
ADD COLUMN "fatherPhone" TEXT,
ADD COLUMN "motherName" TEXT,
ADD COLUMN "motherPhone" TEXT;