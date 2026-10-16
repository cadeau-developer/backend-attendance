// End-to-end smoke test against a running instance of the API.
// Requires: DB migrated + seeded, and `npm run dev` (or start) running in another terminal.
//   node scripts/smoke-test.js
require("dotenv").config();

const BASE_URL = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function shiftDate(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousWeekday(iso) {
  let date = shiftDate(iso, -1);
  while ([0, 6].includes(new Date(`${date}T00:00:00.000Z`).getUTCDay())) {
    date = shiftDate(date, -1);
  }
  return date;
}

async function main() {
  const stamp = Date.now();
  const headmasterEmail = `head${stamp}@school.test`;
  const teacherEmail = `teacher${stamp}@school.test`;

  console.log("1. Register headmaster (creates school as PENDING)...");
  const reg = await call("POST", "/auth/register-headmaster", {
    body: {
      schoolName: `Test School ${stamp}`,
      schoolType: "Primary",
      address: "12 Example Street",
      city: "Kigali",
      schoolPhone: "0731234567",
      schoolEmail: `school${stamp}@test.app`,
      name: "Head Master",
      phone: "0783456789",
      email: headmasterEmail,
      password: "password123",
    },
  });
  assert(reg.user.school.status === "PENDING", "school should start PENDING");
  assert(reg.user.school.city === "Kigali", "school should keep its city");
  const schoolId = reg.user.school.id;

  console.log("2. Headmaster is blocked until approved...");
  let blocked = false;
  try {
    await call("POST", "/teachers", {
      token: reg.token,
      body: { name: "x", email: "x@x.com", password: "password123" },
    });
  } catch (e) {
    blocked = /SCHOOL_PENDING|403/.test(e.message);
  }
  assert(blocked, "headmaster of a pending school should be blocked from managing teachers");

  console.log("3. Login as super admin and approve the school...");
  const adminLogin = await call("POST", "/auth/login", {
    body: { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD },
  });
  assert(adminLogin.user.role === "SUPER_ADMIN", "seeded user should be SUPER_ADMIN");
  await call("POST", `/admin/schools/${schoolId}/approve`, { token: adminLogin.token });

  console.log("4. Headmaster logs in again, registers a teacher and a class...");
  const headLogin = await call("POST", "/auth/login", {
    body: { email: headmasterEmail, password: "password123" },
  });
  const { teacher } = await call("POST", "/teachers", {
    token: headLogin.token,
    body: { name: "Jane Teacher", email: teacherEmail, password: "password123" },
  });
  const { class: klass } = await call("POST", "/classes", {
    token: headLogin.token,
    body: { name: "P5A", teacherId: teacher.id },
  });

  const noAttendanceWeekday = previousWeekday(new Date().toISOString().slice(0, 10));
  const noAttendanceReport = await call(
    "GET",
    `/attendance/report?date=${noAttendanceWeekday}`,
    { token: headLogin.token }
  );
  assert(
    noAttendanceReport.offDay?.auto === true &&
      noAttendanceReport.pendingClasses.length === 0,
    "a past weekday with no attendance submissions should be reported as an automatic off day"
  );

  console.log("5. Teacher logs in, registers students, submits attendance...");
  const teacherLogin = await call("POST", "/auth/login", {
    body: { email: teacherEmail, password: "password123" },
  });

  const sWithPhoto = await call("POST", `/classes/${klass.id}/students`, {
    token: teacherLogin.token,
    body: { name: "Cara", photoUrl: "data:image/png;base64,cara" },
  });
  assert(sWithPhoto.student.photoUrl === "data:image/png;base64,cara", "student create should store photoUrl");

  const s1 = await call("POST", `/classes/${klass.id}/students`, {
    token: teacherLogin.token,
    body: { name: "Alice" },
  });
  const s2 = await call("POST", `/classes/${klass.id}/students`, {
    token: teacherLogin.token,
    body: { name: "Bob" },
  });

  const today = new Date().toISOString().slice(0, 10);
  const dayOfWeek = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const attendanceDate = dayOfWeek === 6 ? shiftDate(today, 2) : dayOfWeek === 0 ? shiftDate(today, 1) : today;
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  const saturday = shiftDate(today, daysUntilSaturday);
  const sunday = shiftDate(saturday, 1);

  console.log("5a. Weekends are closed unless the headmaster opens a specific date...");
  for (const weekendDate of [saturday, sunday]) {
    let blocked = false;
    try {
      await call("POST", "/attendance", {
        token: teacherLogin.token,
        body: { classId: klass.id, date: weekendDate, unavailable: [] },
      });
    } catch (e) {
      blocked = /weekend/i.test(e.message);
    }
    assert(blocked, `${weekendDate} should be closed for attendance by default`);
  }

  let weekdayOverrideRejected = false;
  try {
    await call("POST", "/off-days/weekend-attendance", {
      token: headLogin.token,
      body: { date: shiftDate(saturday, 2) },
    });
  } catch (e) {
    weekdayOverrideRejected = /Saturday or Sunday/i.test(e.message);
  }
  assert(weekdayOverrideRejected, "weekend attendance override should reject weekdays");

  const allowedWeekend = await call("POST", "/off-days/weekend-attendance", {
    token: headLogin.token,
    body: { date: saturday },
  });
  assert(allowedWeekend.weekendAttendanceDay.date.slice(0, 10) === saturday, "headmaster should open the selected Saturday");
  const weekendList = await call("GET", "/off-days/weekend-attendance", { token: teacherLogin.token });
  assert(weekendList.weekendAttendanceDays.some((item) => item.date.slice(0, 10) === saturday), "teachers should see an opened weekend date");
  await call("POST", "/attendance", {
    token: teacherLogin.token,
    body: { classId: klass.id, date: saturday, unavailable: [] },
  });
  const weekendReport = await call("GET", `/attendance/report?date=${saturday}`, { token: headLogin.token });
  assert(weekendReport.offDay === null, "an opened weekend date should not be reported as an off day");
  await call("DELETE", `/off-days/weekend-attendance/${saturday}`, { token: headLogin.token });
  let closedAgain = false;
  try {
    await call("POST", "/attendance", {
      token: teacherLogin.token,
      body: { classId: klass.id, date: saturday, unavailable: [] },
    });
  } catch (e) {
    closedAgain = /weekend/i.test(e.message);
  }
  assert(closedAgain, "removing the override should close the weekend date again");
  const closedWeekendReport = await call("GET", `/attendance/report?date=${saturday}`, { token: headLogin.token });
  assert(
    closedWeekendReport.offDay?.weekend === true && closedWeekendReport.pendingClasses.length === 0,
    "closed weekend reports should identify the default closure and have no pending classes"
  );

  const schoolOffDate = shiftDate(attendanceDate, 7);
  const schoolOffDay = await call("POST", "/off-days", {
    token: headLogin.token,
    body: { date: schoolOffDate, label: "School closure" },
  });
  let schoolOffBlocked = false;
  try {
    await call("POST", "/attendance", {
      token: teacherLogin.token,
      body: { classId: klass.id, date: schoolOffDate, unavailable: [] },
    });
  } catch (e) {
    schoolOffBlocked = /off day/i.test(e.message);
  }
  assert(schoolOffBlocked, "headmaster should still be able to mark an arbitrary weekday as an off day");
  await call("DELETE", `/off-days/${schoolOffDay.offDay.id}`, { token: headLogin.token });

  await call("POST", "/attendance", {
    token: teacherLogin.token,
    body: {
      classId: klass.id,
      date: attendanceDate,
      unavailable: [{ studentId: s2.student.id, reason: "Illness" }],
    },
  });

  console.log("6. Teacher files a discipline case for Alice...");
  await call("POST", "/discipline-cases", {
    token: teacherLogin.token,
    body: { studentId: s1.student.id, description: "Disrupted class" },
  });

  console.log("7. Headmaster views the attendance report and discipline cases...");
  const report = await call(
    "GET",
    `/attendance/report?date=${attendanceDate}`,
    { token: headLogin.token }
  );
  assert(report.unavailable.length === 1, "expected exactly one unavailable student on the attendance date");
  assert(report.unavailable[0].student.name === "Bob", "Bob should be the unavailable student");
  assert(
    Array.isArray(report.pendingClasses),
    "report should include pendingClasses even when the date is an off day"
  );

  const cases = await call("GET", "/discipline-cases", { token: headLogin.token });
  assert(cases.disciplineCases.length === 1, "expected one discipline case");
  assert(cases.disciplineCases[0].reviewed === false, "new discipline case should not be reviewed yet");

  const dashboard = await call("GET", "/dashboard", { token: headLogin.token });
  assert(dashboard.stats.totalTeachers === 1, "dashboard should count one teacher");
  assert(dashboard.stats.totalClasses === 1, "dashboard should count one class");
  assert(
    dashboard.stats.todayUnavailable === (attendanceDate === today ? 1 : 0),
    "dashboard should count attendance recorded today only when the attendance date is today"
  );
  assert(Array.isArray(dashboard.weekly) && dashboard.weekly.length === 7, "dashboard weekly window should cover 7 days");

  console.log("8. Headmaster reviews the discipline case and checks Bob's history...");
  const reviewed = await call("PATCH", `/discipline-cases/${cases.disciplineCases[0].id}/review`, {
    token: headLogin.token,
  });
  assert(reviewed.disciplineCase.reviewed === true, "reviewing should set reviewed = true");

  const history = await call("GET", `/students/${s2.student.id}/history`, { token: headLogin.token });
  assert(history.stats.unavailableCount === 1, "Bob should have exactly one unavailable day");
  assert(history.stats.presentCount === 1, "Bob should have one present day from the opened weekend");
  assert(history.stats.recordedDays === 2, "Bob should have two recorded days");
  assert(history.stats.presenceRate === 50, "Bob presence rate should be 50%");
  const aliceHistory = await call("GET", `/students/${s1.student.id}/history`, { token: headLogin.token });
  assert(aliceHistory.disciplineCases.length === 1, "Alice's history should include her discipline case");
  assert(aliceHistory.disciplineCases[0].reviewed === true, "Alice's case should now show reviewed = true");

  console.log("9. Teacher updates her profile photo and a student photo...");
  const mePatch = await call("PATCH", "/auth/me", {
    token: teacherLogin.token,
    body: { avatarUrl: "data:image/jpeg;base64,teacherface" },
  });
  assert(mePatch.user.avatarUrl === "data:image/jpeg;base64,teacherface", "teacher avatar should be updated");

  const photoPatch = await call("PATCH", `/classes/${klass.id}/students/${s1.student.id}`, {
    token: teacherLogin.token,
    body: { photoUrl: "data:image/png;base64,aliceface" },
  });
  assert(photoPatch.student.photoUrl === "data:image/png;base64,aliceface", "student photo should be updated");

  const genderPatch = await call("PATCH", `/classes/${klass.id}/students/${s1.student.id}`, {
    token: teacherLogin.token,
    body: { gender: "Female" },
  });
  assert(genderPatch.student.gender === "Female", "gender should be updated");
  const s1AfterGender = await call("GET", `/classes/${klass.id}/students`, { token: teacherLogin.token });
  assert(
    s1AfterGender.students.find((s) => s.id === s1.student.id)?.gender === "Female",
    "gender should persist after a refetch"
  );

  console.log("10. Headmaster uploads a school logo...");
  const schoolPatch = await call("PATCH", "/schools/me", {
    token: headLogin.token,
    body: { logoUrl: "data:image/png;base64,logo", city: "Kigali" },
  });
  assert(schoolPatch.school.logoUrl === "data:image/png;base64,logo", "school logo should be stored");
  const headMe = await call("GET", "/auth/me", { token: headLogin.token });
  assert(headMe.user.school.logoUrl === "data:image/png;base64,logo", "/auth/me should expose the school logo");

  console.log("11. Super admin marks tomorrow as an off day; attendance is blocked...");
  const offDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const offDay = await call("POST", "/off-days", {
    token: adminLogin.token,
    body: { date: offDate, label: "School holiday" },
  });
  assert(offDay.offDay.date.slice(0, 10) === offDate, "off day should be created for the given date");
  const offDayList = await call("GET", "/off-days", { token: teacherLogin.token });
  assert(offDayList.offDays.some((o) => o.date.slice(0, 10) === offDate), "teacher should see the off day");
  let blockedAttendance = false;
  try {
    await call("POST", "/attendance", {
      token: teacherLogin.token,
      body: { classId: klass.id, date: offDate, unavailable: [] },
    });
  } catch (e) {
    blockedAttendance = /off day/i.test(e.message);
  }
  assert(blockedAttendance, "teacher should not be able to take attendance on an off day");
  const offReport = await call("GET", `/attendance/report?date=${offDate}`, { token: headLogin.token });
  assert(offReport.offDay && offReport.pendingClasses.length === 0, "report on an off day should not list pending classes");
  await call("DELETE", `/off-days/${offDay.offDay.id}`, { token: adminLogin.token });

  console.log("12. Super admin registers a school with an optional logo + headmaster login...");
  const adminSchoolEmail = `adminmade${stamp}@school.test`;
  const created = await call("POST", "/admin/schools", {
    token: adminLogin.token,
    body: {
      name: `Admin-Made School ${stamp}`,
      schoolType: "Secondary",
      address: "44 Admin Street",
      city: "Kigali",
      phone: "0722345678",
      email: `adminschool${stamp}@test.app`,
      logoUrl: "data:image/png;base64,adminlogo",
      headmasterName: "Ms. Admin",
      headmasterPhone: "0733456789",
      headmasterEmail: adminSchoolEmail,
      headmasterPassword: "password123",
    },
  });
  assert(created.school.status === "PENDING", "admin-registered school should default to PENDING");
  assert(created.school.logoUrl === "data:image/png;base64,adminlogo", "admin-registered school should store its logo");
  assert(created.headmaster && created.headmaster.email === adminSchoolEmail, "admin-registered school should create a headmaster login");

  const adminMadeLogin = await call("POST", "/auth/login", {
    body: { email: adminSchoolEmail, password: "password123" },
  });
  assert(adminMadeLogin.user.role === "HEADMASTER", "the created headmaster should be able to log in");
  assert(adminMadeLogin.user.school.logoUrl === "data:image/png;base64,adminlogo", "the created headmaster should see the school logo");

  console.log("12b. Super admin approves the admin-made school...");
  const adminMadeSchoolId = adminMadeLogin.user.schoolId;
  await call("POST", `/admin/schools/${adminMadeSchoolId}/approve`, { token: adminLogin.token });
  const adminMadeApproved = await call("POST", "/auth/login", {
    body: { email: adminSchoolEmail, password: "password123" },
  });
  assert(adminMadeApproved.user.school.status === "APPROVED", "admin-made school should be APPROVED after approval");

  console.log("13. Headmaster marks a past date as an off day for his own school...");
  const pastDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const schoolOff = await call("POST", "/off-days", {
    token: adminMadeApproved.token,
    body: { date: pastDate, label: "School cleanup day" },
  });
  assert(schoolOff.offDay.schoolId === adminMadeApproved.user.schoolId, "headmaster off day should be scoped to his school");
  const schoolOffList = await call("GET", "/off-days", { token: adminMadeApproved.token });
  assert(
    schoolOffList.offDays.some((o) => o.date.slice(0, 10) === pastDate),
    "headmaster should see his school's off day"
  );

  const otherHead = await call("POST", "/auth/login", {
    body: { email: headmasterEmail, password: "password123" },
  });
  const otherSchoolOffList = await call("GET", "/off-days", { token: otherHead.token });
  assert(
    !otherSchoolOffList.offDays.some((o) => o.date.slice(0, 10) === pastDate),
    "a headmaster should NOT see another school's off day"
  );
  const offReportScoped = await call("GET", `/attendance/report?date=${pastDate}`, { token: adminMadeApproved.token });
  assert(offReportScoped.offDay && offReportScoped.pendingClasses.length === 0, "report on a school off day should not list pending classes");
  await call("DELETE", `/off-days/${schoolOff.offDay.id}`, { token: adminMadeApproved.token });

  console.log("14. A past day with no submitted attendance is auto-marked as an off day...");
  const autoOffDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const autoReport = await call("GET", `/attendance/report?date=${autoOffDate}`, { token: headLogin.token });
  assert(autoReport.offDay && autoReport.offDay.auto === true, "a past day with no submissions should be auto-marked as an off day");
  assert(autoReport.offDay.label, "the auto-marked off day should carry a label");
  assert(autoReport.pendingClasses.length === 0, "an auto-marked off day should not list pending classes");

  console.log("15. A class can still submit on an auto-marked past day, which unmarks it...");
  const backfill = await call("POST", "/attendance", {
    token: teacherLogin.token,
    body: { classId: klass.id, date: autoOffDate, unavailable: [] },
  });
  assert(Array.isArray(backfill.attendance), "teacher should be able to submit on an auto-marked past day");
  const afterBackfill = await call("GET", `/attendance/report?date=${autoOffDate}`, { token: headLogin.token });
  assert(afterBackfill.offDay === null, "an auto-marked off day should unmark once a class submits attendance");
  assert(afterBackfill.pendingClasses.length === 0, "all classes should be counted once a class submits on the auto-off day");

  console.log("16. Headmaster can mark a future date as an off day...");
  const futureOffDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const futureOff = await call("POST", "/off-days", {
    token: headLogin.token,
    body: { date: futureOffDate, label: "Planned closure" },
  });
  assert(futureOff.offDay.date.slice(0, 10) === futureOffDate, "headmaster should be able to create a future off day");
  const futureOffList = await call("GET", "/off-days", { token: headLogin.token });
  assert(
    futureOffList.offDays.some((o) => o.date.slice(0, 10) === futureOffDate && o.schoolId === schoolId),
    "the future off day should appear in the headmaster's list"
  );
  const futureReport = await call("GET", `/attendance/report?date=${futureOffDate}`, { token: headLogin.token });
  assert(futureReport.offDay && futureReport.pendingClasses.length === 0, "report on a future off day should not list pending classes");
  await call("DELETE", `/off-days/${futureOff.offDay.id}`, { token: headLogin.token });

  console.log("\nAll smoke tests passed.");
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err.message);
  process.exit(1);
});
