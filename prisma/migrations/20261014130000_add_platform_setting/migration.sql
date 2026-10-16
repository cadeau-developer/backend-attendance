-- Platform-wide settings set by the super admin (single row, id = 1).
CREATE TABLE "PlatformSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "schoolYear" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" INTEGER,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
