-- Sync columns/indexes that were applied to existing databases outside the
-- migration history: school/student/user address fields, student gender and
-- birth date, drop the leftover unique index on Class.teacherId, and align the
-- Student -> Class foreign key with the schema (ON DELETE SET NULL).
ALTER TABLE "Student" DROP CONSTRAINT "Student_classId_fkey";

DROP INDEX "Class_teacherId_key";

ALTER TABLE "School" ADD COLUMN     "cell" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "village" TEXT;

ALTER TABLE "Student" ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "cell" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "village" TEXT;

ALTER TABLE "User" ADD COLUMN     "cell" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "village" TEXT;

ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
