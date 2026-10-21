-- CreateTable
CREATE TABLE "SchoolYear" (
    "id" SERIAL NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "starts" DATE NOT NULL,
    "ends" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolYear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolYear_schoolId_idx" ON "SchoolYear"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_schoolId_year_key" ON "SchoolYear"("schoolId", "year");

-- AddForeignKey
ALTER TABLE "SchoolYear" ADD CONSTRAINT "SchoolYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
