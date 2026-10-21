-- School-wide terms. The current term has ends = NULL; ending a term closes it
-- and the next term starts on the same day.
CREATE TABLE "SchoolTerm" (
    "id" SERIAL NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "starts" DATE NOT NULL,
    "ends" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolTerm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchoolTerm_schoolId_idx" ON "SchoolTerm"("schoolId");

ALTER TABLE "SchoolTerm"
ADD CONSTRAINT "SchoolTerm_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
