import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";

import {
  initializeApp,
  getApps,
  cert,
} from "firebase-admin/app";

import {
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";

import {
  getAuth,
} from "firebase-admin/auth";

import {
  generateIdFromName,
} from "./admin/id-utils.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const projectRoot = path.dirname(
  fileURLToPath(import.meta.url)
);

const PROJECT_ID = "rankhub-28aa8";

app.disable("x-powered-by");

// ============================================================
// BODY PARSERS
// ============================================================

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// ============================================================
// ADMIN STATIC FILES
// ============================================================

const adminStaticRoot = path.join(
  projectRoot,
  "admin"
);

app.use(
  express.static(adminStaticRoot)
);

app.use(
  "/admin",
  express.static(adminStaticRoot)
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      adminStaticRoot,
      "admin-dashboard.html"
    )
  );
});

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      adminStaticRoot,
      "admin-dashboard.html"
    )
  );
});

app.get("/favicon.ico", (req, res) => {
  res.sendStatus(204);
});

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigin =
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
      origin
    );

  if (allowedOrigin) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );

    res.setHeader(
      "Vary",
      "Origin"
    );
  }

  res.setHeader(
    "Access-Control-Allow-Credentials",
    "true"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Key, Authorization, X-Admin-Scope"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ============================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================

let db = null;
let auth = null;

function initializeFirebase() {
  try {
    let serviceAccountRaw =
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountRaw) {
      const keyPath = path.join(
        projectRoot,
        "serviceAccountKey.json"
      );

      if (fs.existsSync(keyPath)) {
        serviceAccountRaw =
          fs.readFileSync(
            keyPath,
            "utf8"
          );

        console.log(
          "[Firebase] Loaded credentials from serviceAccountKey.json file."
        );
      }
    }

    if (
      serviceAccountRaw &&
      serviceAccountRaw.trim().startsWith("{")
    ) {
      if (getApps().length === 0) {
        const serviceAccount =
          JSON.parse(serviceAccountRaw);

        if (
          serviceAccount.project_id !==
          PROJECT_ID
        ) {
          throw new Error(
            `Service account project mismatch: expected ${PROJECT_ID}, received ${serviceAccount.project_id || "unknown"}.`
          );
        }

        initializeApp({
          credential: cert(serviceAccount),
          projectId: PROJECT_ID,
        });
      }

      db = getFirestore();
      auth = getAuth();

      console.log(
        `[Firebase] Connected to project: ${PROJECT_ID}`
      );
    } else {
      console.warn(
        "[Firebase] No service account configured. Admin API is unavailable."
      );

      db = null;
    }
  } catch (error) {
    console.warn(
      "[Firebase] Initialization failed. Admin API is unavailable:",
      error?.message
    );

    db = null;
    auth = null;
    auth = null;
  }
}

initializeFirebase();

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/api/health",
  async (req, res) => {
    res.json({
      success: true,
      service: "rankhub-admin",
      firebaseProject: PROJECT_ID,
      firebaseAdminInitialized: Boolean(db),
    });
  }
);

// ============================================================
// FIREBASE SAFETY
// ============================================================

function requireDb(res) {
  if (!db) {
    res.status(503).json({
      success: false,
      error:
        "Firebase Admin is not initialized. Check serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT_KEY.",
    });

    return false;
  }

  return true;
}

// ============================================================
// VERIFICATION HELPERS
// ============================================================

async function verifyDocumentDeleted(
  reference,
  resource,
  id
) {
  const snapshot =
    await reference.get();

  if (snapshot.exists) {
    const error = new Error(
      `Delete verification failed for ${resource}: ${id} still exists after deletion.`
    );

    error.statusCode = 500;

    throw error;
  }
}

async function verifyDocumentCreated(
  reference,
  resource,
  id
) {
  const snapshot =
    await reference.get();

  if (!snapshot.exists) {
    const error = new Error(
      `Save verification failed for ${resource}: ${id} was not created.`
    );

    error.statusCode = 500;

    throw error;
  }
}

// ============================================================
// DOCUMENT ID VALIDATION
// ============================================================

function validateDocumentId(id) {
  return (
    typeof id === "string" &&
    /^[A-Za-z0-9_-]{1,150}$/.test(id)
  );
}

function validateExamId(id) {
  return (
    typeof id === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
  );
}

function normalizeLiveTestDate(dateValue) {
  if (typeof dateValue !== "string") {
    return "";
  }

  const trimmed = dateValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "";
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }

  const safeDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(safeDate.getTime()) ||
    safeDate.getUTCFullYear() !== year ||
    safeDate.getUTCMonth() !== month - 1 ||
    safeDate.getUTCDate() !== day
  ) {
    return "";
  }

  return trimmed;
}

function normalizeLiveTestTime(timeValue) {
  if (typeof timeValue !== "string" || !/^\d{2}:\d{2}$/.test(timeValue.trim())) {
    return "";
  }

  const [hour, minute] = timeValue.trim().split(":").map(Number);
  if (hour > 23 || minute > 59) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function combineLiveTestDateTime(dateValue, timeValue) {
  const date = normalizeLiveTestDate(dateValue);
  const time = normalizeLiveTestTime(timeValue);
  if (!date || !time) {
    return null;
  }

  return new Date(`${date}T${time}:00.000Z`);
}

function getLiveTestAutoStatus(liveTest) {
  const startAt = liveTest?.startAt?.toDate
    ? liveTest.startAt.toDate()
    : new Date(liveTest?.startAt || "");
  const endAt = liveTest?.endAt?.toDate
    ? liveTest.endAt.toDate()
    : new Date(liveTest?.endAt || "");

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return "ENDED";
  }

  const now = Date.now();
  if (now < startAt.getTime()) return "UPCOMING";
  if (now <= endAt.getTime()) return "LIVE NOW";
  return "ENDED";
}

function serializeLiveTest(snapshot) {
  const data = snapshot.data() || {};
  const questions = data.questionCount || 0;

  return {
    ...data,
    id: snapshot.id,
    questionCount: Number(questions) || 0,
    published: Boolean(data.published),
    status: getLiveTestAutoStatus(data),
    startAt: data.startAt?.toDate?.()?.toISOString?.() || data.startAt || null,
    endAt: data.endAt?.toDate?.()?.toISOString?.() || data.endAt || null,
  };
}

function validateLiveTestQuestion(question, rowNumber) {
  const value = question && typeof question === "object" ? question : {};
  const questionText = String(value.questionText || "").trim();
  const optionA = String(value.optionA || "").trim();
  const optionB = String(value.optionB || "").trim();
  const optionC = String(value.optionC || "").trim();
  const optionD = String(value.optionD || "").trim();
  const correctAnswer = String(value.correctAnswer || "").trim().toUpperCase();
  const errors = [];

  if (!questionText) errors.push(`Row ${rowNumber}: questionText is required.`);
  if (!optionA || !optionB || !optionC || !optionD) {
    errors.push(`Row ${rowNumber}: optionA, optionB, optionC and optionD are required.`);
  }
  if (!["A", "B", "C", "D"].includes(correctAnswer)) {
    errors.push(`Row ${rowNumber}: correctAnswer must be A, B, C or D.`);
  }

  return {
    errors,
    question: { questionText, optionA, optionB, optionC, optionD, correctAnswer },
  };
}

function buildUniqueLiveTestId(title, existingIds = []) {
  const base = generateIdFromName(title || "");
  if (!base) {
    return "";
  }

  const used = new Set((existingIds || []).map((id) => String(id || "")));
  let candidate = base;
  let counter = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

// ============================================================
// GENERIC FIRESTORE HELPERS
// ============================================================

async function getCollection(name) {
  if (!db) {
    throw new Error(
      "Firebase Admin is not initialized."
    );
  }

  const snap =
    await db
      .collection(name)
      .get();

  return snap.docs.map(
    (document) => ({
      ...document.data(),
      id: document.id,
    })
  );
}

async function setDocument(
  name,
  id,
  data
) {
  if (!db) {
    throw new Error(
      "Firebase Admin is not initialized."
    );
  }

  await db
    .collection(name)
    .doc(id)
    .set(
      {
        ...data,
        id,
      },
      {
        merge: true,
      }
    );
}

async function deleteDocument(
  name,
  id
) {
  if (!db) {
    throw new Error(
      "Firebase Admin is not initialized."
    );
  }

  await db
    .collection(name)
    .doc(id)
    .delete();
}

// ============================================================
// ADMIN STATS
// ============================================================

const DASHBOARD_STATS_FAILURE_COOLDOWN_MS = 30 * 1000;

let dashboardStatsInFlight = null;

let dashboardStatsFailureUntil = 0;

async function getQueryCount(label, query) {
  try {
    const snapshot = await query.count().get();
    return Number(snapshot.data().count || 0);
  } catch (error) {
    console.error(
      `[Admin Stats] Count query failed for ${label}:`,
      error
    );
    throw error;
  }
}

async function calculateDashboardStats() {
  const users = db.collection("users");

  const totalUsers =
    await getQueryCount(
      "users.total",
      users
    );

  const suspendedUsers =
    await getQueryCount(
      "users.suspended",
      users.where(
        "status",
        "==",
        "suspended"
      )
    );

  const premiumUsers =
    await getQueryCount(
      "users.premium",
      users.where(
        "isPremium",
        "==",
        true
      )
    );

  const totalExams =
    await getQueryCount(
      "exams.total",
      db.collection("exams")
    );

  const totalSubjects =
    await getQueryCount(
      "subjects.total",
      db.collectionGroup("subjects")
    );

  const totalTopics =
    await getQueryCount(
      "topics.total",
      db.collectionGroup("topics")
    );

  const totalQuestions =
    await getQueryCount(
      "questions.total",
      db.collection("questions")
    );

  const totalTestSeries =
    await getQueryCount(
      "test_series.total",
      db.collectionGroup("test_series")
    );

  const totalMockTests =
    await getQueryCount(
      "mock_tests.total",
      db.collectionGroup("mock_tests")
    );

  const totalLiveTests =
    await getQueryCount(
      "live_tests.total",
      db.collection("live_tests")
    );

  const totalPYQ =
    await getQueryCount(
      "pyq.total",
      db.collectionGroup("pyq")
    );

  const totalResults =
    await getQueryCount(
      "results.total",
      db.collection("results")
    );

  const totalNotes =
    await getQueryCount(
      "pdf_notes.total",
      db.collection("pdf_notes")
    );

  const totalCurrentAffairs =
    await getQueryCount(
      "current_affairs.total",
      db.collection("current_affairs")
    );

  return {
    success: true,

    totalUsers,

    activeUsers:
      Math.max(
        0,
        totalUsers - suspendedUsers
      ),

    premiumUsers,

    totalExams,

    totalSubjects,

    totalTopics,

    totalQuestions,

    totalTestSeries,

    totalMockTests,

    totalLiveTests,

    totalPYQ,

    totalResults,

    totalNotes,

    totalCurrentAffairs,
  };
}

function buildDashboardStatsResponse(data, extra = {}) {
  const { success: _success, ...stats } = data || {};
  return {
    success: true,
    stats,
    ...stats,
    ...extra,
  };
}

app.get(
  "/api/admin/stats",
  async (req, res) => {
    let statsRequest = null;

    try {
      if (!requireDb(res)) return;

      const now = Date.now();

      if (dashboardStatsFailureUntil > now) {
        return res.status(503).json({
          success: false,
          error: "Dashboard statistics temporarily unavailable",
        });
      }

      if (dashboardStatsInFlight) {
        statsRequest = dashboardStatsInFlight;
        const data = await statsRequest;

        return res.json(
          buildDashboardStatsResponse(
            data,
            { cached: true }
          )
        );
      }

      statsRequest = calculateDashboardStats();
      dashboardStatsInFlight = statsRequest;

      const data = await statsRequest;

      dashboardStatsFailureUntil = 0;

      return res.json(
        buildDashboardStatsResponse(
          data,
          { cached: false }
        )
      );
    } catch (error) {
      console.error(
        "[Admin Stats] Failed:",
        error
      );

      const errorText = String(
        error?.message ||
        error?.code ||
        ''
      );

      if (
        errorText.includes('RESOURCE_EXHAUSTED') ||
        errorText.toLowerCase().includes('quota exceeded')
      ) {
        console.warn(
          "[Admin Stats] Firebase quota exhausted; fresh statistics are unavailable."
        );
      }

      dashboardStatsFailureUntil =
        Date.now() +
        DASHBOARD_STATS_FAILURE_COOLDOWN_MS;

      res.status(503).json({
        success: false,
        error: "Dashboard statistics temporarily unavailable",
      });
    } finally {
      if (
        statsRequest &&
        dashboardStatsInFlight === statsRequest
      ) {
        dashboardStatsInFlight = null;
      }
    }
  }
);

// ============================================================
// NESTED FIRESTORE STRUCTURE
// ============================================================

const NESTED_CHILD_COLLECTIONS = {
  subjects: "subjects",
  topics: "topics",
  "test-series": "test_series",
  "mock-tests": "mock_tests",
  pyqs: "pyq",
};

function isNestedRoute(route) {
  return Boolean(
    NESTED_CHILD_COLLECTIONS[route]
  );
}

// ============================================================
// GET NESTED COLLECTION
// ============================================================

async function getNestedCollection(
  route,
  examId
) {
  const childCollection =
    NESTED_CHILD_COLLECTIONS[route];

  if (!childCollection) {
    return [];
  }

  const records = [];

  const examReference =
    db
      .collection("exams")
      .doc(examId);

  // ==========================================================
  // TOPICS
  // exams/{examId}/subjects/{subjectId}/topics
  // ==========================================================

  if (route === "topics") {
    const subjectsSnapshot =
      await examReference
        .collection("subjects")
        .get();

    for (
      const subjectDocument
      of subjectsSnapshot.docs
    ) {
      const topicSnapshot =
        await subjectDocument.ref
          .collection("topics")
          .get();

      topicSnapshot.forEach(
        (document) => {
          records.push({
            ...document.data(),
            id: document.id,
            examId,
            subjectId:
              subjectDocument.id,
          });
        }
      );
    }

    return records;
  }

  // ==========================================================
  // NORMAL NESTED COLLECTION
  // ==========================================================

  const childSnapshot =
    await examReference
      .collection(childCollection)
      .get();

  childSnapshot.forEach(
    (document) => {
      records.push({
        ...document.data(),
        id: document.id,
        examId,
      });
    }
  );

  return records;
}

async function getRouteCollection(
  route,
  collection,
  examId
) {
  if (isNestedRoute(route)) {
    return getNestedCollection(
      route,
      examId
    );
  }

  return getCollection(collection);
}

// ============================================================
// NESTED PARENT VALIDATION
// ============================================================

async function getNestedParent(
  route,
  body
) {
  const examId =
    typeof body.examId === "string"
      ? body.examId.trim()
      : "";

  if (
    !examId ||
    !validateExamId(examId)
  ) {
    const error = new Error(
      "examId is required and must be a valid exam document ID."
    );

    error.statusCode = 400;

    throw error;
  }

  const examReference =
    db
      .collection("exams")
      .doc(examId);

  const examSnapshot =
    await examReference.get();

  if (!examSnapshot.exists) {
    const error = new Error(
      `Selected exam does not exist: ${examId}`
    );

    error.statusCode = 404;

    throw error;
  }

  // ==========================================================
  // TOPICS
  // ==========================================================

  if (route === "topics") {
    const subjectId =
      typeof body.subjectId === "string"
        ? body.subjectId.trim()
        : "";

    if (
      !subjectId ||
      !validateDocumentId(subjectId)
    ) {
      const error = new Error(
        "subjectId is required and must be a valid subject document ID."
      );

      error.statusCode = 400;

      throw error;
    }

    const subjectReference =
      examReference
        .collection("subjects")
        .doc(subjectId);

    const subjectSnapshot =
      await subjectReference.get();

    if (!subjectSnapshot.exists) {
      const error = new Error(
        `Selected subject does not exist for exam ${examId}: ${subjectId}`
      );

      error.statusCode = 404;

      throw error;
    }

    return subjectReference;
  }

  return examReference;
}

// ============================================================
// GENERIC CRUD
// ============================================================

function setupCrud(
  route,
  collection
) {
  // ==========================================================
  // GET
  // ==========================================================

  app.get(
    `/api/admin/${route}`,
    async (req, res) => {
      try {
        if (!requireDb(res)) return;

        const examId =
          typeof req.query.examId === "string"
            ? req.query.examId.trim()
            : "";

        if (
          isNestedRoute(route) &&
          !validateExamId(examId)
        ) {
          return res.status(400).json({
            success: false,
            error:
              "examId must be the actual Firestore exam document ID.",
          });
        }

        const data =
          await getRouteCollection(
            route,
            collection,
            examId
          );

        res.json(data);
      } catch (error) {
        console.error(
          `[Admin GET ${route}] Failed:`,
          error
        );

        res.status(
          error?.statusCode || 500
        ).json({
          success: false,
          error:
            error?.message ||
            `Failed to load ${route}.`,
        });
      }
    }
  );

  // ==========================================================
  // POST / CREATE / UPDATE
  // ==========================================================

  app.post(
    `/api/admin/${route}`,
    async (req, res) => {
      try {
        if (!requireDb(res)) return;

        const body =
          req.body || {};

        if (
          typeof body !== "object" ||
          Array.isArray(body)
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid request body.",
          });
        }

        const isUpdate =
          typeof body.id === "string" &&
          Boolean(body.id.trim());

        // ====================================================
        // Validate nested parent
        // ====================================================

        const nestedParent =
          isNestedRoute(route)
            ? await getNestedParent(
                route,
                body
              )
            : null;

        // ====================================================
        // Requested ID
        // ====================================================

        const requestedId =
          isUpdate
            ? body.id.trim()
            : route === "exams"
              ? typeof body.code === "string"
                ? body.code.trim()
                : ""
              : route === "subjects"
                ? typeof body.code === "string"
                  ? body.code.trim()
                  : ""
                : route === "topics"
                  ? typeof body.code === "string"
                    ? body.code.trim()
                    : ""
                  : route === "mock-tests"
                    ? typeof body.code === "string"
                      ? body.code.trim()
                      : ""
                    : route === "pyqs"
                      ? typeof body.code === "string"
                        ? body.code.trim()
                        : ""
                      : route === "test-series"
                        ? typeof body.code === "string"
                          ? body.code.trim()
                          : ""
                        : null;

        // ====================================================
        // Required generated IDs
        // ====================================================

        if (
          !isUpdate &&
          [
            "exams",
            "subjects",
            "topics",
            "mock-tests",
            "test-series",
            "pyqs",
          ].includes(route)
        ) {
          if (
            typeof requestedId !== "string" ||
            !requestedId
          ) {
            return res.status(400).json({
              success: false,
              error: "ID is required.",
            });
          }
        }

        // ====================================================
        // New IDs must be slug-safe
        // ====================================================

        if (
          [
            "exams",
            "subjects",
            "topics",
            "mock-tests",
            "test-series",
          ].includes(route) &&
          !isUpdate &&
          !validateExamId(requestedId)
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Generated ID must use lowercase letters, numbers, and hyphens only.",
          });
        }

        // ====================================================
        // Firestore reference
        // ====================================================

        let reference;
        let deleteExamId = "";
        let deleteSubjectId = "";
        let id;

        if (requestedId) {
          if (
            !validateDocumentId(
              requestedId
            )
          ) {
            return res.status(400).json({
              success: false,
              error:
                "ID must contain only letters, numbers, hyphens, or underscores.",
            });
          }

          if (nestedParent) {
            reference =
              nestedParent
                .collection(
                  NESTED_CHILD_COLLECTIONS[
                    route
                  ]
                )
                .doc(requestedId);
          } else {
            reference =
              db
                .collection(collection)
                .doc(requestedId);
          }

          id = requestedId;
        } else {
          if (nestedParent) {
            reference =
              nestedParent
                .collection(
                  NESTED_CHILD_COLLECTIONS[
                    route
                  ]
                )
                .doc();
          } else {
            reference =
              db
                .collection(collection)
                .doc();
          }

          id = reference.id;
        }

        // ====================================================
        // Exam update validation
        // ====================================================

        if (
          route === "exams" &&
          isUpdate
        ) {
          const existingExam =
            await reference.get();

          if (!existingExam.exists) {
            return res.status(404).json({
              success: false,
              error:
                "Exam not found.",
            });
          }

          id = requestedId;
        }

        const now =
          Timestamp.now();

        // ====================================================
        // PAYLOAD
        // ====================================================

        const payload = {
          ...body,

          id,

          ...(route === "exams"
            ? {
                examId: id,
                code: id,
              }
            : {}),

          ...(route === "subjects"
            ? {
                examId:
                  body.examId.trim(),
                code: id,
              }
            : {}),

          ...(route === "test-series"
            ? {
                examId:
                  body.examId.trim(),
                code: id,
              }
            : {}),

          ...(route === "topics"
            ? {
                examId:
                  body.examId.trim(),
                subjectId:
                  body.subjectId.trim(),
                code: id,
              }
            : {}),

          updatedAt: now,

          ...(isUpdate
            ? {}
            : {
                createdAt: now,
              }),
        };

        // ====================================================
        // SAVE
        // ====================================================

        await db.runTransaction(
          async (transaction) => {
            if (isUpdate) {
              transaction.set(
                reference,
                payload,
                {
                  merge: true,
                }
              );

              return;
            }

            const existing =
              await transaction.get(
                reference
              );

            if (existing.exists) {
              const duplicateError =
                new Error(
                  "An item with this generated ID already exists. Please use a different name."
                );

              duplicateError.statusCode =
                409;

              throw duplicateError;
            }

            transaction.create(
              reference,
              payload
            );
          }
        );

        // ====================================================
        // EXACT FIRESTORE VERIFICATION
        // ====================================================

        if (
          route === "subjects" ||
          route === "test-series"
        ) {
          await verifyDocumentCreated(
            reference,
            route,
            id
          );

          console.log(
            "[RANKHUB FIRESTORE VERIFIED]",
            reference.path
          );
        }

        console.log(
          "[RANKHUB FIRESTORE SAVE]",
          {
            resource: route,
            id,
            examId:
              body.examId || null,
            firestorePath:
              reference.path,
          }
        );

        return res.json({
          success: true,
          id,
          data: payload,
        });
      } catch (error) {
        console.error(
          `[Admin POST ${route}] Failed:`,
          error
        );

        return res
          .status(
            error?.statusCode || 500
          )
          .json({
            success: false,
            error:
              error?.message ||
              `Failed to save ${route}.`,
          });
      }
    }
  );

  // ==========================================================
  // DELETE
  // ==========================================================

  app.delete(
    `/api/admin/${route}/:id`,
    async (req, res) => {
      try {
        if (!requireDb(res)) return;

        const id =
          req.params.id;

        if (
          !id ||
          !validateDocumentId(id)
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Document ID is required.",
          });
        }

        let reference;

        // ====================================================
        // NESTED DELETE
        // ====================================================

        if (isNestedRoute(route)) {
          const examId =
            String(
              req.query.examId || ""
            ).trim();
          deleteExamId = examId;

          if (!validateExamId(examId)) {
            return res.status(400).json({
              success: false,
              error:
                "Valid examId is required.",
            });
          }

          const examReference =
            db
              .collection("exams")
              .doc(examId);

          if (
            route === "topics"
          ) {
            const subjectId =
              String(
                req.query.subjectId || ""
              ).trim();
            deleteSubjectId = subjectId;

            if (
              !validateDocumentId(
                subjectId
              )
            ) {
              return res.status(400).json({
                success: false,
                error:
                  "Valid subjectId is required for topic deletion.",
              });
            }

            reference =
              examReference
                .collection("subjects")
                .doc(subjectId)
                .collection("topics")
                .doc(id);
          } else {
            reference =
              examReference
                .collection(
                  NESTED_CHILD_COLLECTIONS[
                    route
                  ]
                )
                .doc(id);
          }
        } else {
          reference =
            db
              .collection(collection)
              .doc(id);
        }

        const existing =
          await reference.get();

        if (!existing.exists) {
          return res.status(404).json({
            success: false,
            error:
              `Document not found in ${route}.`,
          });
        }

        console.log(
          "[RANKHUB ADMIN DELETE]",
          {
            resource: route,
            id,
            firestorePath:
              reference.path,
          }
        );

        const questionCleanup = [
          "exams",
          "subjects",
          "topics",
          "test-series",
          "mock-tests",
        ].includes(route)
          ? await deleteOwnedQuestions(
              route,
              id,
              route === "exams" ? id : deleteExamId,
              deleteSubjectId
            )
          : { deletedQuestions: 0, cleanedReferences: 0 };
        const directQuestionReferenceCleanup = route === "questions"
          ? await cleanQuestionReferences([id])
          : 0;

        await deleteDocumentTree(reference);

        await verifyDocumentDeleted(
          reference,
          route,
          id
        );

        await verifyDocumentTreeDeleted(
          reference,
          route,
          id
        );

        console.log(
          `[Admin ${route}] Deleted document: ${id}`
        );

        return res.json({
          success: true,
          id,
          deletedId: id,
          resource: route,
          deletedQuestions: questionCleanup.deletedQuestions,
          cleanedReferences:
            questionCleanup.cleanedReferences + directQuestionReferenceCleanup,
        });
      } catch (error) {
        console.error(
          `[Admin DELETE ${route}] Failed:`,
          error
        );

        return res.status(
          error?.statusCode || 500
        ).json({
          success: false,
          error:
            error?.message ||
            `Failed to delete ${route}.`,
        });
      }
    }
  );
}

// ============================================================
// UNIVERSAL BULK DELETE
// ============================================================

const BULK_DELETE_COLLECTIONS = {
  users: "users",
  exams: "exams",
  subjects: "subjects",
  topics: "topics",
  questions: "questions",
  "test-series": "test_series",
  "mock-tests": "mock_tests",
  "live-tests": "live_tests",
  pyqs: "pyq",
  results: "results",
  notes: "pdf_notes",
  "current-affairs": "current_affairs",
  notifications: "notifications",
};

// ============================================================
// BULK SCOPE RESOLVER
//
// IMPORTANT FIX:
// examId / subjectId can come from:
// 1. JSON body
// 2. Query parameters
// 3. X-Admin-Scope header
//
// Priority:
// BODY -> QUERY -> HEADER
// ============================================================

function getBulkRequestScope(req) {
  const body =
    req.body &&
    typeof req.body === "object"
      ? req.body
      : {};

  const query =
    req.query &&
    typeof req.query === "object"
      ? req.query
      : {};

  let headerScope =
    new URLSearchParams();

  const rawHeader =
    req.headers[
      "x-admin-scope"
    ];

  if (
    typeof rawHeader === "string" &&
    rawHeader.trim()
  ) {
    try {
      headerScope =
        new URLSearchParams(
          rawHeader
        );
    } catch {
      headerScope =
        new URLSearchParams();
    }
  }

  const bodyExamId =
    typeof body.examId === "string"
      ? body.examId.trim()
      : "";

  const queryExamId =
    typeof query.examId === "string"
      ? query.examId.trim()
      : "";

  const headerExamId =
    typeof headerScope.get("examId") ===
      "string"
      ? headerScope
          .get("examId")
          .trim()
      : "";

  const bodySubjectId =
    typeof body.subjectId === "string"
      ? body.subjectId.trim()
      : "";

  const querySubjectId =
    typeof query.subjectId === "string"
      ? query.subjectId.trim()
      : "";

  const headerSubjectId =
    typeof headerScope.get(
      "subjectId"
    ) === "string"
      ? headerScope
          .get("subjectId")
          .trim()
      : "";

  return {
    examId:
      bodyExamId ||
      queryExamId ||
      headerExamId ||
      "",

    subjectId:
      bodySubjectId ||
      querySubjectId ||
      headerSubjectId ||
      "",
  };
}

// ============================================================
// FIND BULK DELETE REFERENCES
// ============================================================

async function findBulkDeleteReferences(
  route,
  id,
  examId,
  subjectId
) {
  const collection =
    BULK_DELETE_COLLECTIONS[route];

  if (!collection) {
    return [];
  }

  // ==========================================================
  // NESTED ROUTES
  // ==========================================================

  if (isNestedRoute(route)) {
    if (!validateExamId(examId)) {
      return [];
    }

    let nestedReference =
      db
        .collection("exams")
        .doc(examId);

    // ========================================================
    // TOPICS
    //
    // exams/{examId}/subjects/{subjectId}/topics/{id}
    // ========================================================

    if (route === "topics") {
      if (
        !validateDocumentId(
          subjectId
        )
      ) {
        return [];
      }

      nestedReference =
        nestedReference
          .collection("subjects")
          .doc(subjectId);
    }

    // ========================================================
    // FINAL CHILD DOCUMENT
    // ========================================================

    const reference =
      nestedReference
        .collection(
          NESTED_CHILD_COLLECTIONS[
            route
          ]
        )
        .doc(id);

    const snapshot =
      await reference.get();

    return snapshot.exists
      ? [reference]
      : [];
  }

  // ==========================================================
  // TOP-LEVEL COLLECTION
  // ==========================================================

  const reference =
    db
      .collection(collection)
      .doc(id);

  const snapshot =
    await reference.get();

  return snapshot.exists
    ? [reference]
    : [];
}

// ============================================================
// UNIVERSAL BULK DELETE ROUTE
// ============================================================

app.delete(
  "/api/admin/:resource/bulk",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const route =
        req.params.resource;

      // ======================================================
      // RESOURCE VALIDATION
      // ======================================================

      if (
        !BULK_DELETE_COLLECTIONS[
          route
        ]
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Bulk delete is not available for this resource.",
        });
      }

      // ======================================================
      // IDS
      // ======================================================

      const ids =
        Array.isArray(
          req.body?.ids
        )
          ? [
              ...new Set(
                req.body.ids
                  .filter(Boolean)
                  .map((id) =>
                    typeof id === "string"
                      ? id.trim()
                      : id
                  )
              ),
            ]
          : [];

      if (
        !ids.length ||
        ids.length > 500 ||
        ids.some(
          (id) =>
            !validateDocumentId(id)
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "ids must contain 1 to 500 valid document IDs.",
        });
      }

      // ======================================================
      // FIX:
      // RESOLVE examId + subjectId FROM BODY / QUERY / HEADER
      // ======================================================

      const {
        examId,
        subjectId,
      } = getBulkRequestScope(req);

      console.log(
        "[RANKHUB BULK DELETE SCOPE]",
        {
          resource: route,
          examId:
            examId || null,
          subjectId:
            subjectId || null,
          source: {
            bodyExamId:
              req.body?.examId ||
              null,
            queryExamId:
              req.query?.examId ||
              null,
            headerScope:
              req.headers[
                "x-admin-scope"
              ] || null,
          },
        }
      );

      // ======================================================
      // NESTED EXAM VALIDATION
      // ======================================================

      if (isNestedRoute(route)) {
        if (
          !validateExamId(examId)
        ) {
          return res.status(400).json({
            success: false,
            error:
              "examId is required for nested bulk delete.",
          });
        }

        const examReference =
          db
            .collection("exams")
            .doc(examId);

        const examSnapshot =
          await examReference.get();

        if (!examSnapshot.exists) {
          return res.status(404).json({
            success: false,
            error:
              `Selected exam does not exist: ${examId}`,
          });
        }

        // ====================================================
        // TOPIC SUBJECT VALIDATION
        // ====================================================

        if (
          route === "topics"
        ) {
          if (
            !validateDocumentId(
              subjectId
            )
          ) {
            return res.status(400).json({
              success: false,
              error:
                "subjectId is required for topic bulk delete.",
            });
          }

          const subjectReference =
            examReference
              .collection("subjects")
              .doc(subjectId);

          const subjectSnapshot =
            await subjectReference.get();

          if (
            !subjectSnapshot.exists
          ) {
            return res.status(404).json({
              success: false,
              error:
                `Selected subject does not exist for exam ${examId}: ${subjectId}`,
            });
          }
        }
      }

      // ======================================================
      // DELETE RESULT ARRAYS
      // ======================================================

      const deletedIds = [];
      const failedIds = [];
      const failureReasons = {};

      const batch =
        db.batch();

      let batchOperationCount = 0;

      // ======================================================
      // FIND AND QUEUE DOCUMENTS
      // ======================================================

      for (const id of ids) {
        try {
          const references =
            await findBulkDeleteReferences(
              route,
              id,
              examId,
              subjectId
            );

          // --------------------------------------------------
          // Ambiguous
          // --------------------------------------------------

          if (
            references.length > 1
          ) {
            failedIds.push(id);

            failureReasons[id] =
              "The ID is ambiguous across related collections.";

            continue;
          }

          // --------------------------------------------------
          // Already deleted / not found
          // --------------------------------------------------

          if (
            references.length === 0
          ) {
            deletedIds.push(id);
            continue;
          }

          if (
            route === "exams" ||
            route === "subjects" ||
            route === "pyqs" ||
            route === "live-tests"
          ) {
            const parentReference =
              references[0];

            const questionCleanup = [
              "exams",
              "subjects",
              "pyqs",
            ].includes(route)
              ? await deleteOwnedQuestions(
                  route,
                  id,
                  route === "exams" ? id : examId,
                  subjectId
                )
              : { deletedQuestions: 0, cleanedReferences: 0 };

            await deleteDocumentTree(parentReference);

            await verifyDocumentDeleted(
              parentReference,
              route,
              id
            );

            await verifyDocumentTreeDeleted(
              parentReference,
              route,
              id
            );

            deletedIds.push(id);

            continue;
          }

          if (
            route === "test-series" ||
            route === "mock-tests"
          ) {
            await deleteOwnedQuestions(
              route,
              id,
              examId
            );
            await deleteDocumentTree(references[0]);
            await verifyDocumentTreeDeleted(
              references[0],
              route,
              id
            );
            deletedIds.push(id);
            continue;
          }

          // --------------------------------------------------
          // Queue delete
          // --------------------------------------------------

          if (route === "questions") {
            await cleanQuestionReferences([id]);
          }

          batch.delete(
            references[0]
          );

          batchOperationCount += 1;

          console.log(
            "[RANKHUB BULK DELETE QUEUED]",
            {
              resource: route,
              id,
              firestorePath:
                references[0].path,
            }
          );
        } catch (itemError) {
          failedIds.push(id);

          failureReasons[id] =
            itemError?.message ||
            "Failed to locate document.";
        }
      }

      // ======================================================
      // COMMIT
      // ======================================================

      if (
        batchOperationCount > 0
      ) {
        await batch.commit();
      }

      // ======================================================
      // VERIFY DELETIONS
      // ======================================================

      for (const id of ids) {
        if (
          deletedIds.includes(id) ||
          failedIds.includes(id)
        ) {
          continue;
        }

        try {
          const references =
            await findBulkDeleteReferences(
              route,
              id,
              examId,
              subjectId
            );

          if (
            references.length > 1
          ) {
            failedIds.push(id);

            failureReasons[id] =
              "The ID is ambiguous across related collections.";

            continue;
          }

          if (
            references.length === 0
          ) {
            deletedIds.push(id);
            continue;
          }

          const snapshot =
            await references[0].get();

          if (snapshot.exists) {
            failedIds.push(id);

            failureReasons[id] =
              "Delete verification failed.";

            continue;
          }

          deletedIds.push(id);
        } catch (verificationError) {
          failedIds.push(id);

          failureReasons[id] =
            verificationError?.message ||
            "Delete verification failed.";
        }
      }

      // ======================================================
      // FINAL RESPONSE
      // ======================================================

      console.log(
        "[RANKHUB BULK DELETE COMPLETE]",
        {
          resource: route,
          examId:
            examId || null,
          subjectId:
            subjectId || null,
          requested:
            ids.length,
          deleted:
            deletedIds.length,
          failed:
            failedIds.length,
        }
      );

      return res.json({
        success:
          failedIds.length === 0,

        resource:
          route,

        examId:
          examId || null,

        subjectId:
          subjectId || null,

        requestedCount:
          ids.length,

        deletedCount:
          deletedIds.length,

        deletedIds,

        failedCount:
          failedIds.length,

        failedIds,

        failureReasons,
      });
    } catch (error) {
      console.error(
        "[Admin bulk delete] Failed:",
        error
      );

      return res.status(
        error?.statusCode || 500
      ).json({
        success: false,
        error:
          error?.message ||
          "Bulk delete failed.",
      });
    }
  }
);

// ============================================================
// BULK QUESTIONS IMPORT
// ============================================================

app.post(
  "/api/admin/questions/bulk",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const questions =
        Array.isArray(
          req.body?.questions
        )
          ? req.body.questions
          : [];

      if (!questions.length) {
        return res.status(400).json({
          success: false,
          error:
            "No questions supplied.",
        });
      }

      const entries =
        questions.map(
          (question) => {
            const requestedId =
              typeof question.id ===
                "string" &&
              question.id.trim()
                ? question.id.trim()
                : null;

            if (
              requestedId &&
              !validateDocumentId(
                requestedId
              )
            ) {
              const validationError =
                new Error(
                  "ID must contain only letters, numbers, hyphens, or underscores."
                );

              validationError.statusCode =
                400;

              throw validationError;
            }

            const questionCollection =
              db.collection(
                "questions"
              );

            const reference =
              requestedId
                ? questionCollection.doc(
                    requestedId
                  )
                : questionCollection.doc();

            const now =
              Timestamp.now();

            const payload = {
              ...question,
              id: reference.id,
              createdAt: now,
              updatedAt: now,
            };

            return {
              reference,
              payload,
            };
          }
        );

      const manualIds =
        entries
          .filter(
            ({
              payload,
            }) =>
              payload.id
          )
          .map(
            ({
              payload,
            }) =>
              payload.id
          );

      if (
        new Set(
          manualIds
        ).size !==
        manualIds.length
      ) {
        return res.status(409).json({
          success: false,
          error:
            "This ID already exists.",
        });
      }

      await db.runTransaction(
        async (transaction) => {
          const snapshots =
            await Promise.all(
              entries.map(
                ({
                  reference,
                }) =>
                  transaction.get(
                    reference
                  )
              )
            );

          if (
            snapshots.some(
              (
                snapshot,
                index
              ) =>
                snapshot.exists &&
                questions[index].id
            )
          ) {
            const duplicateError =
              new Error(
                "This ID already exists."
              );

            duplicateError.statusCode =
              409;

            throw duplicateError;
          }

          entries.forEach(
            ({
              reference,
              payload,
            }) => {
              transaction.create(
                reference,
                payload
              );
            }
          );
        }
      );

      const imported =
        entries.map(
          ({
            payload,
          }) => payload
        );

      console.log(
        `[Firestore BULK questions] Imported: ${imported.length}`
      );

      res.json({
        success: true,
        imported:
          imported.length,
        data: imported,
      });
    } catch (error) {
      console.error(
        "[Firestore BULK questions] failed:",
        error
      );

      res.status(
        error?.statusCode || 500
      ).json({
        success: false,
        error:
          error?.message ||
          "Bulk import failed.",
      });
    }
  }
);

// ============================================================
// GENERATE & SAVE CURRENT AFFAIRS ROUTE
// ============================================================

app.post(
  "/api/admin/current-affairs/generate",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const body = req.body || {};
      const date = typeof body.date === "string" ? body.date.trim() : "";
      const category = typeof body.category === "string" ? body.category.trim() : "National";

      if (!date) {
        return res.status(400).json({
          success: false,
          error: "Date is required for generating current affairs.",
        });
      }

      // उदाहरण के तौर पर सैंपल करंट अफेयर्स प्रश्न (आप चाहें तो यहाँ अपना जनरेशन लॉजिक लगा सकते हैं)
      const sampleQuestions = [
        {
          question: `Important National Event on ${date}`,
          options: ["Option A", "Option B", "Option C", "Option D"],
          answerIndex: 1,
          explanation: "Detailed explanation of the current affairs event.",
          category: category === "all" ? "National" : category,
          status: "published",
          source: "RankHub News Desk",
          sourceUrl: ""
        }
      ];

      const savedItems = [];
      const caCollection = db.collection("current_affairs");

      for (let i = 0; i < sampleQuestions.length; i++) {
        const qData = sampleQuestions[i];
        const docId = `ca_${date.replaceAll("-", "_")}_${String(i + 1).padStart(3, "0")}`;
        const docRef = caCollection.doc(docId);

        const payload = {
          ...qData,
          id: docId,
          date,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        await docRef.set(payload, { merge: true });
        savedItems.push(payload);
      }

      console.log(`[Admin Current Affairs] Saved ${savedItems.length} items for date: ${date}`);

      return res.json({
        success: true,
        message: `${savedItems.length} current affairs generated and saved successfully.`,
        items: savedItems,
        questions: savedItems,
        generated: savedItems.length,
        created: savedItems.length,
      });
    } catch (error) {
      console.error("[Admin POST current-affairs/generate] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to generate current affairs.",
      });
    }
  }
);

// ============================================================
// PYQ HELPERS
// ============================================================

function normalizePYQ(
  document
) {
  const data =
    document.data();

  return {
    ...data,
    id: document.id,

    examId:
      data.examId ||
      data.examID ||
      data.exam_id ||
      data.targetExamId ||
      "",
  };
}

function validatePYQBody(
  body
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return "Invalid request body.";
  }

  if (
    typeof body.examId !==
      "string" ||
    !body.examId.trim()
  ) {
    return "examId is required and must be the selected exam document ID.";
  }

  if (
    !body.title ||
    typeof body.title !==
      "string" ||
    !body.title.trim()
  ) {
    return "title is required.";
  }

  const year =
    Number(body.year);

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2100
  ) {
    return "year must be a valid number.";
  }

  if (
    body.totalQuestions !==
      undefined &&
    body.totalQuestions !== ""
  ) {
    const totalQuestions =
      Number(
        body.totalQuestions
      );

    if (
      !Number.isInteger(
        totalQuestions
      ) ||
      totalQuestions < 1
    ) {
      return "totalQuestions must be a positive number.";
    }
  }

  if (
    body.pdfUrl !==
      undefined &&
    body.pdfUrl !== ""
  ) {
    try {
      const pdfUrl =
        new URL(
          body.pdfUrl
        );

      if (
        !/^https?:$/.test(
          pdfUrl.protocol
        )
      ) {
        throw new Error(
          "Invalid protocol"
        );
      }
    } catch {
      return "pdfUrl must be a valid HTTP or HTTPS URL.";
    }
  }

  return null;
}

async function getPYQExam(
  examId
) {
  const examReference =
    db
      .collection("exams")
      .doc(examId);

  const examSnapshot =
    await examReference.get();

  return examSnapshot.exists
    ? examSnapshot.data()
    : null;
}

// ============================================================
// PYQ DIAGNOSTIC
// ============================================================

app.get(
  "/api/admin/pyq/diagnostic",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const examId =
        String(
          req.query.examId || ""
        ).trim();

      if (
        !validateExamId(examId)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "examId is required for nested PYQ diagnostics.",
        });
      }

      const snapshot =
        await db
          .collection("exams")
          .doc(examId)
          .collection("pyq")
          .get();

      res.json({
        success: true,
        collection:
          `exams/${examId}/pyq`,
        firebaseProject:
          PROJECT_ID,
        count:
          snapshot.size,
      });
    } catch (error) {
      console.error(
        "[Admin PYQ diagnostic] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error.message ||
          "Diagnostic failed.",
      });
    }
  }
);

// ============================================================
// GET PYQ
// ============================================================

app.get(
  "/api/admin/pyq",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const examId =
        String(
          req.query.examId || ""
        ).trim();

      if (
        !validateExamId(examId)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "examId must be the actual Firestore exam document ID.",
        });
      }

      const snapshot =
        await db
          .collection("exams")
          .doc(examId)
          .collection("pyq")
          .get();

      let records =
        snapshot.docs.map(
          normalizePYQ
        );

      records =
        records.map(
          (record) => ({
            ...record,
            examId,
          })
        );

      if (req.query.year) {
        records =
          records.filter(
            (record) =>
              Number(
                record.year
              ) ===
              Number(
                req.query.year
              )
          );
      }

      const exams =
        await getCollection(
          "exams"
        );

      const examsById =
        new Map(
          exams.map(
            (exam) => [
              exam.id,
              exam,
            ]
          )
        );

      records =
        records.map(
          (record) => ({
            ...record,

            examName:
              record.examName ||
              examsById.get(
                record.examId
              )?.name ||
              "",
          })
        );

      res.json(records);
    } catch (error) {
      console.error(
        "[Admin GET pyq] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error.message ||
          "Failed to load PYQs.",
      });
    }
  }
);

// ============================================================
// CREATE PYQ
// ============================================================

app.post(
  "/api/admin/pyq",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const body = {
        ...req.body,
      };

      const requestedId =
        typeof body.id === "string" &&
        body.id.trim()
          ? body.id.trim()
          : typeof body.code === "string" &&
            body.code.trim()
            ? body.code.trim()
            : "";

      const validationError =
        validatePYQBody(body);

      if (validationError) {
        return res.status(400).json({
          success: false,
          error:
            validationError,
        });
      }

      if (
        !validateExamId(
          body.examId.trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "examId must be the actual Firestore exam document ID.",
        });
      }

      const exam =
        await getPYQExam(
          body.examId
        );

      if (!exam) {
        return res.status(404).json({
          success: false,
          error:
            "Selected exam does not exist.",
        });
      }

      if (
        !requestedId ||
        !validateDocumentId(
          requestedId
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "PYQ ID is required and must contain only letters, numbers, hyphens, or underscores.",
        });
      }

      if (
        !body.id &&
        !validateExamId(requestedId)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Generated ID must use lowercase letters, numbers, and hyphens only.",
        });
      }

      const reference =
        db
          .collection("exams")
          .doc(body.examId)
          .collection("pyq")
          .doc(requestedId);

      const existing =
        await reference.get();

      if (existing.exists) {
        return res.status(409).json({
          success: false,
          error:
            "An item with this generated ID already exists. Please use a different name.",
        });
      }

      const now =
        Timestamp.now();

      const payload = {
        examId:
          body.examId,

        examName:
          exam.name ||
          body.examName ||
          "",

        stageId:
          body.stageId ||
          null,

        stageName:
          typeof body.stageName === "string"
            ? body.stageName.trim()
            : "",

        stage:
          typeof body.stage === "string"
            ? body.stage.trim()
            : body.stageName ||
              "",

        title:
          body.title.trim(),

        year:
          Number(
            body.year
          ),

        shift:
          typeof body.shift ===
            "string"
            ? body.shift.trim()
            : "",

        totalQuestions:
          body.totalQuestions === "" ||
          body.totalQuestions ===
            undefined
            ? null
            : Number(
                body.totalQuestions
              ),

        hasAnswerKey:
          Boolean(
            body.hasAnswerKey
          ),

        pdfUrl:
          typeof body.pdfUrl ===
            "string"
            ? body.pdfUrl.trim()
            : "",

        status:
          body.status === "active"
            ? "active"
            : "draft",

        createdAt: now,
        updatedAt: now,
        id: requestedId,
        code: requestedId,
      };

      await reference.set(
        payload
      );

      console.log(
        "[RANKHUB FIRESTORE SAVE]",
        {
          resource: "pyq",
          id: requestedId,
          examId: body.examId,
          firestorePath:
            reference.path,
        }
      );

      return res.status(201).json({
        success: true,
        id: requestedId,
        data: payload,
      });
    } catch (error) {
      console.error(
        "[Admin POST pyq] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error.message ||
          "Failed to save PYQ.",
      });
    }
  }
);

// ============================================================
// UPDATE PYQ
// ============================================================

async function updatePYQ(
  req,
  res
) {
  try {
    if (!requireDb(res)) return;

    const id =
      req.params.id;

    if (
      !validateDocumentId(id)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Valid document ID is required.",
      });
    }

    const validationError =
      validatePYQBody(
        req.body
      );

    if (validationError) {
      return res.status(400).json({
        success: false,
        error:
          validationError,
      });
    }

    if (
      !validateExamId(
        req.body.examId
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "examId must be the actual Firestore exam document ID.",
      });
    }

    const reference =
      db
        .collection("exams")
        .doc(req.body.examId)
        .collection("pyq")
        .doc(id);

    const existing =
      await reference.get();

    if (!existing.exists) {
      return res.status(404).json({
        success: false,
        error:
          "PYQ document not found.",
      });
    }

    const exam =
      await getPYQExam(
        req.body.examId
      );

    if (!exam) {
      return res.status(404).json({
        success: false,
        error:
          "Selected exam does not exist.",
      });
    }

    const existingData =
      existing.data();

    const payload = {
      ...req.body,

      id,

      examId:
        req.body.examId,

      examName:
        exam.name ||
        req.body.examName ||
        "",

      year:
        Number(
          req.body.year
        ),

      totalQuestions:
        req.body.totalQuestions === "" ||
        req.body.totalQuestions ===
          undefined
          ? null
          : Number(
              req.body.totalQuestions
            ),

      hasAnswerKey:
        Boolean(
          req.body.hasAnswerKey
        ),

      status:
        req.body.status ===
        "active"
          ? "active"
          : "draft",

      createdAt:
        existingData.createdAt ||
        Timestamp.now(),

      updatedAt:
        Timestamp.now(),
    };

    await reference.set(
      payload,
      {
        merge: false,
      }
    );

    console.log(
      "[RANKHUB FIRESTORE UPDATE]",
      {
        resource: "pyq",
        id,
        examId:
          req.body.examId,
        firestorePath:
          reference.path,
      }
    );

    return res.json({
      success: true,
      id,
      data: payload,
    });
  } catch (error) {
    console.error(
      `[Admin ${req.method} pyq] Failed:`,
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to update PYQ.",
    });
  }
}

app.put(
  "/api/admin/pyq/:id",
  updatePYQ
);

app.patch(
  "/api/admin/pyq/:id",
  updatePYQ
);

// ============================================================
// DELETE PYQ
// ============================================================

app.delete(
  "/api/admin/pyq/:id",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      if (
        !validateDocumentId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Valid document ID is required.",
        });
      }

      const examId =
        String(
          req.query.examId || ""
        ).trim();

      if (
        !validateExamId(examId)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "examId is required for PYQ deletion.",
        });
      }

      const reference =
        db
          .collection("exams")
          .doc(examId)
          .collection("pyq")
          .doc(req.params.id);

      const existing =
        await reference.get();

      if (!existing.exists) {
        return res.status(404).json({
          success: false,
          error:
            "PYQ document not found.",
        });
      }

      const questionCleanup = await deleteOwnedQuestions(
        "pyqs",
        req.params.id,
        examId
      );

      const questionSnapshot = await reference.collection("questions").get();
      const deleteBatch = db.batch();
      questionSnapshot.docs.forEach((question) => deleteBatch.delete(question.ref));
      deleteBatch.delete(reference);
      await deleteBatch.commit();

      await verifyDocumentDeleted(
        reference,
        "pyq",
        req.params.id
      );

      console.log(
        "[RANKHUB FIRESTORE DELETE]",
        {
          resource: "pyq",
          id: req.params.id,
          examId,
          firestorePath:
            reference.path,
        }
      );

      return res.json({
        success: true,
        id:
          req.params.id,
        deletedQuestions:
          questionCleanup.deletedQuestions + questionSnapshot.size,
        cleanedReferences:
          questionCleanup.cleanedReferences,
      });
    } catch (error) {
      console.error(
        "[Admin DELETE pyq] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error.message ||
          "Failed to delete PYQ.",
      });
    }
  }
);

// ============================================================
// EXAM CASCADE DELETE HELPERS
// ============================================================

async function deleteReferencesInBatches(
  references
) {
  if (
    !Array.isArray(references) ||
    references.length === 0
  ) {
    return 0;
  }

  let deletedCount = 0;

  for (
    let index = 0;
    index < references.length;
    index += 500
  ) {
    const batch =
      db.batch();

    const slice =
      references.slice(
        index,
        index + 500
      );

    for (const ref of slice) {
      batch.delete(ref);
    }

    await batch.commit();

    deletedCount +=
      slice.length;
  }

  return deletedCount;
}

async function collectDocumentTreeReferences(
  reference,
  references = []
) {
  const childCollections =
    await reference.listCollections();

  for (const childCollection of childCollections) {
    const snapshot =
      await childCollection.get();

    for (const document of snapshot.docs) {
      await collectDocumentTreeReferences(
        document.ref,
        references
      );

      references.push(document.ref);
    }
  }

  return references;
}

async function deleteDocumentTree(reference) {
  const descendants =
    await collectDocumentTreeReferences(reference);

  await deleteReferencesInBatches(descendants);
  await reference.delete();
}

async function deleteOwnedQuestions(
  route,
  id,
  examId,
  subjectId = ""
) {
  const questionsSnapshot = await db.collection("questions").get();
  const candidates = questionsSnapshot.docs.filter((document) => {
    const question = document.data() || {};
    const sameExam = !examId || String(question.examId || "") === String(examId);

    if (!sameExam) return false;
    if (route === "exams") return true;
    if (route === "subjects") return String(question.subjectId || "") === String(id);
    if (route === "topics") {
      return String(question.subjectId || "") === String(subjectId) &&
        String(question.topicId || "") === String(id);
    }
    if (route === "test-series") return String(question.testSeriesId || "") === String(id);
    if (route === "mock-tests") {
      return String(question.mockTestId || question.mockId || "") === String(id);
    }
    if (route === "pyqs") return String(question.pyqId || "") === String(id);
    return false;
  });

  if (!candidates.length) return { deletedQuestions: 0, cleanedReferences: 0 };

  const examsSnapshot = await db.collection("exams").get();
  const survivingReferences = new Set();
  const referencesToClean = [];

  for (const exam of examsSnapshot.docs) {
    const mockTests = await exam.ref.collection("mock_tests").get();
    for (const mock of mockTests.docs) {
      const data = mock.data() || {};
      const questionIds = Array.isArray(data.questionIds)
        ? data.questionIds.map(String)
        : Array.isArray(data.question_ids)
          ? data.question_ids.map(String)
          : [];
      const candidateIds = new Set(candidates.map((document) => document.id));
      const referencedCandidateIds = questionIds.filter((questionId) => candidateIds.has(questionId));

      if (!referencedCandidateIds.length) continue;

      const isDeletedMock = route === "mock-tests" &&
        String(exam.id) === String(examId) &&
        String(mock.id) === String(id);

      if (isDeletedMock) continue;

      referencedCandidateIds.forEach((questionId) => survivingReferences.add(questionId));
    }
  }

  const questionRefsToDelete = candidates
    .filter((document) => !survivingReferences.has(document.id))
    .map((document) => document.ref);
  const questionIdsToDelete = new Set(questionRefsToDelete.map((ref) => ref.id));

  for (const exam of examsSnapshot.docs) {
    const mockTests = await exam.ref.collection("mock_tests").get();
    for (const mock of mockTests.docs) {
      if (route === "mock-tests" && String(exam.id) === String(examId) && String(mock.id) === String(id)) continue;

      const data = mock.data() || {};
      const key = Array.isArray(data.questionIds) ? "questionIds" : "question_ids";
      const currentIds = Array.isArray(data[key]) ? data[key].map(String) : [];
      const nextIds = currentIds.filter((questionId) => !questionIdsToDelete.has(questionId));
      if (nextIds.length !== currentIds.length) {
        referencesToClean.push({ ref: mock.ref, field: key, value: nextIds });
      }
    }
  }

  for (let index = 0; index < referencesToClean.length; index += 500) {
    const batch = db.batch();
    referencesToClean.slice(index, index + 500).forEach(({ ref, field, value }) => batch.update(ref, { [field]: value }));
    await batch.commit();
  }

  await deleteReferencesInBatches(questionRefsToDelete);
  return {
    deletedQuestions: questionRefsToDelete.length,
    cleanedReferences: referencesToClean.length,
  };
}

async function cleanQuestionReferences(questionIds) {
  const ids = new Set((questionIds || []).map(String));
  if (!ids.size) return 0;

  const examsSnapshot = await db.collection("exams").get();
  const updates = [];

  for (const exam of examsSnapshot.docs) {
    const mockTests = await exam.ref.collection("mock_tests").get();
    for (const mock of mockTests.docs) {
      const data = mock.data() || {};
      const field = Array.isArray(data.questionIds) ? "questionIds" : "question_ids";
      const currentIds = Array.isArray(data[field]) ? data[field].map(String) : [];
      const nextIds = currentIds.filter((questionId) => !ids.has(questionId));
      if (nextIds.length !== currentIds.length) {
        updates.push({ ref: mock.ref, field, value: nextIds });
      }
    }
  }

  for (let index = 0; index < updates.length; index += 500) {
    const batch = db.batch();
    updates.slice(index, index + 500).forEach(({ ref, field, value }) => batch.update(ref, { [field]: value }));
    await batch.commit();
  }

  return updates.length;
}

async function findRemainingDocumentTree(reference) {
  const childCollections =
    await reference.listCollections();

  for (const childCollection of childCollections) {
    const snapshot =
      await childCollection.get();

    if (!snapshot.empty) {
      return snapshot.docs[0].ref.path;
    }
  }

  return null;
}

async function verifyDocumentTreeDeleted(
  reference,
  resource,
  id
) {
  const remainingPath =
    await findRemainingDocumentTree(reference);

  if (remainingPath) {
    const error = new Error(
      `Delete verification failed for ${resource} ${id}: nested document remains at ${remainingPath}.`
    );

    error.statusCode = 500;
    throw error;
  }
}

async function verifyExamCascadeDeleted(
  examId
) {
  const examRef =
    db
      .collection("exams")
      .doc(examId);

  const examSnapshot =
    await examRef.get();

  if (examSnapshot.exists) {
    return {
      success: false,
      reason:
        "Main exam still exists.",
    };
  }

  const remainingPath =
    await findRemainingDocumentTree(examRef);

  if (remainingPath) {
    return {
      success: false,
      reason:
        `Nested document still exists at ${remainingPath}.`,
    };
  }

  return {
    success: true,
  };
}

// ============================================================
// EXAM CASCADE DELETE
// IMPORTANT:
// THIS MUST COME BEFORE GENERIC EXAM DELETE ROUTE.
// ============================================================

app.delete(
  "/api/admin/exams/:examId",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const examId =
        String(
          req.params.examId || ""
        ).trim();

      if (
        !examId ||
        !validateExamId(examId)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Valid examId is required.",
        });
      }

      const examRef =
        db
          .collection("exams")
          .doc(examId);

      const examSnapshot =
        await examRef.get();

      if (!examSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error:
            "Exam not found.",
        });
      }

      console.log(
        "[RANKHUB ADMIN DELETE] Exam cascade start:",
        {
          examId,
          firestorePath:
            examRef.path,
        }
      );

      const questionCleanup = await deleteOwnedQuestions(
        "exams",
        examId,
        examId
      );

      const referencesToDelete = [];

      // ========================================================
      // SUBJECTS + TOPICS
      // ========================================================

      const subjectsSnapshot =
        await examRef
          .collection("subjects")
          .get();

      let totalTopicCount = 0;

      for (
        const subjectDocument
        of subjectsSnapshot.docs
      ) {
        const topicsSnapshot =
          await subjectDocument.ref
            .collection("topics")
            .get();

        totalTopicCount +=
          topicsSnapshot.size;

        for (
          const topicDocument
          of topicsSnapshot.docs
        ) {
          referencesToDelete.push(
            topicDocument.ref
          );
        }

        referencesToDelete.push(
          subjectDocument.ref
        );
      }

      // ========================================================
      // TEST SERIES
      // ========================================================

      const testSeriesSnapshot =
        await examRef
          .collection("test_series")
          .get();

      for (
        const document
        of testSeriesSnapshot.docs
      ) {
        referencesToDelete.push(
          document.ref
        );
      }

      // ========================================================
      // MOCK TESTS
      // DO NOT CHANGE STRUCTURE
      // ========================================================

      const mockTestsSnapshot =
        await examRef
          .collection("mock_tests")
          .get();

      for (
        const document
        of mockTestsSnapshot.docs
      ) {
        referencesToDelete.push(
          document.ref
        );
      }

      // ========================================================
      // PYQ
      // DO NOT CHANGE STRUCTURE
      // ========================================================

      const pyqSnapshot =
        await examRef
          .collection("pyq")
          .get();

      for (
        const document
        of pyqSnapshot.docs
      ) {
          const questionsSnapshot =
            await document.ref
              .collection("questions")
              .get();

          for (
            const questionDocument
            of questionsSnapshot.docs
          ) {
            referencesToDelete.push(
              questionDocument.ref
            );
          }

        referencesToDelete.push(
          document.ref
        );
      }

      // ========================================================
      // REMOVE DUPLICATES
      // ========================================================

      const uniqueRefs = [];
      const seenPaths =
        new Set();

      for (
        const ref
        of referencesToDelete
      ) {
        if (
          seenPaths.has(
            ref.path
          )
        ) {
          continue;
        }

        seenPaths.add(
          ref.path
        );

        uniqueRefs.push(
          ref
        );
      }

      // ========================================================
      // DELETE THE COMPLETE EXAM DOCUMENT TREE
      // ========================================================

      await deleteDocumentTree(examRef);

      console.log(
        "[RANKHUB ADMIN DELETE] Main exam deleted:",
        examId
      );

      // ========================================================
      // VERIFY
      // ========================================================

      const verification =
        await verifyExamCascadeDeleted(
          examId
        );

      if (
        !verification.success
      ) {
        return res.status(500).json({
          success: false,
          examId,
          error:
            verification.reason ||
            "Exam cascade verification failed.",
        });
      }

      // ========================================================
      // COUNTS
      // ========================================================

      const deletedCounts = {
        exam: 1,

        subjects:
          subjectsSnapshot.size,

        topics:
          totalTopicCount,

        testSeries:
          testSeriesSnapshot.size,

        mockTests:
          mockTestsSnapshot.size,

        pyqs:
          pyqSnapshot.size,
      };

      return res.json({
        success: true,
        examId,
        deleted:
          deletedCounts,
        deletedQuestions:
          questionCleanup.deletedQuestions,
        cleanedReferences:
          questionCleanup.cleanedReferences,
      });
    } catch (error) {
      console.error(
        "[Admin DELETE exam cascade] Failed:",
        error
      );

      return res.status(
        error?.statusCode || 500
      ).json({
        success: false,
        error:
          error?.message ||
          "Failed to delete exam and related records.",
      });
    }
  }
);

// ============================================================
// EXPLICIT ADMIN GET ROUTES (required by admin-db.js)
// ============================================================

app.get(
  "/api/admin/exams",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const examId =
        typeof req.query.examId === "string"
          ? req.query.examId.trim()
          : "";

      if (examId && !validateExamId(examId)) {
        return res.status(400).json({
          success: false,
          error: "examId must be the actual Firestore exam document ID.",
        });
      }

      const data = await getCollection("exams");
      res.json(data);
    } catch (error) {
      console.error("[Admin GET exams] Failed:", error);
      res.status(error?.statusCode || 500).json({
        success: false,
        error: error?.message || "Failed to load exams.",
      });
    }
  }
);

app.get(
  "/api/admin/mock-tests",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const examId =
        typeof req.query.examId === "string"
          ? req.query.examId.trim()
          : "";

      if (examId && !validateExamId(examId)) {
        return res.status(400).json({
          success: false,
          error: "examId must be the actual Firestore exam document ID.",
        });
      }

      if (examId) {
        const examReference = db.collection("exams").doc(examId);
        const examSnapshot = await examReference.get();

        if (!examSnapshot.exists) {
          return res.status(404).json({
            success: false,
            error: `Selected exam does not exist: ${examId}`,
          });
        }

        const snapshot = await examReference.collection("mock_tests").get();
        const records = snapshot.docs.map((document) => ({
          ...document.data(),
          id: document.id,
          examId,
        }));

        return res.json(records);
      }

      const exams = await getCollection("exams");
      const results = await Promise.all(
        exams.map(async (exam) => {
          const examReference = db.collection("exams").doc(exam.id);
          const snapshot = await examReference.collection("mock_tests").get();
          return snapshot.docs.map((document) => ({
            ...document.data(),
            id: document.id,
            examId: exam.id,
          }));
        })
      );

      res.json(results.flat());
    } catch (error) {
      console.error("[Admin GET mock-tests] Failed:", error);
      res.status(error?.statusCode || 500).json({
        success: false,
        error: error?.message || "Failed to load mock tests.",
      });
    }
  }
);

function isProtectedAdminUser(userId, userRecord) {
  const protectedUid =
    process.env.ADMIN_PROTECTED_UID ||
    process.env.RANKHUB_ADMIN_UID ||
    process.env.ADMIN_UID ||
    "";

  const protectedEmail =
    process.env.ADMIN_PROTECTED_EMAIL ||
    process.env.RANKHUB_ADMIN_EMAIL ||
    "";

  const claims =
    userRecord?.customClaims ||
    {};

  return (
    (protectedUid && userId === protectedUid) ||
    (protectedEmail && userRecord?.email === protectedEmail) ||
    claims.admin === true ||
    claims.role === "admin" ||
    claims.role === "superadmin"
  );
}

app.delete(
  "/api/admin/users/:id",
  async (req, res) => {
    let authDeleted = false;
    let firestoreDeleted = false;

    try {
      if (!requireDb(res)) return;

      if (!auth) {
        return res.status(503).json({
          success: false,
          error: "Firebase Admin Auth is not initialized.",
        });
      }

      const userId =
        String(req.params.id || "").trim();

      if (!validateDocumentId(userId)) {
        return res.status(400).json({
          success: false,
          error: "Valid Firebase user UID is required.",
        });
      }

      const firestoreReference =
        db.collection("users").doc(userId);

      const firestoreSnapshot =
        await firestoreReference.get();

      if (!firestoreSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Firestore user document not found.",
        });
      }

      let authUser = null;
      let authAlreadyMissing = false;

      try {
        authUser = await auth.getUser(userId);
      } catch (error) {
        if (error?.code === "auth/user-not-found") {
          authAlreadyMissing = true;
        } else {
          throw error;
        }
      }

      if (isProtectedAdminUser(userId, authUser)) {
        return res.status(403).json({
          success: false,
          error: "The protected admin account cannot be deleted.",
        });
      }

      if (authUser) {
        await auth.deleteUser(userId);
        authDeleted = true;
      }

      try {
        await firestoreReference.delete();
        await verifyDocumentDeleted(
          firestoreReference,
          "users",
          userId
        );
        firestoreDeleted = true;
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            "Firebase Authentication user was deleted, but the Firestore user document could not be deleted.",
          authDeleted,
          firestoreDeleted,
          detail: error?.message || "Firestore delete failed.",
        });
      }

      return res.json({
        success: true,
        id: userId,
        authDeleted,
        authAlreadyMissing,
        firestoreDeleted,
      });
    } catch (error) {
      console.error(
        "[Admin DELETE users] Failed:",
        error
      );

      return res.status(
        error?.statusCode || 500
      ).json({
        success: false,
        error:
          error?.message ||
          "Failed to delete user.",
        authDeleted,
        firestoreDeleted,
      });
    }
  }
);

// ============================================================
// STANDARD CRUD ROUTES
// ============================================================

setupCrud(
  "exams",
  "exams"
);

setupCrud(
  "users",
  "users"
);

setupCrud(
  "subjects",
  "subjects"
);

setupCrud(
  "topics",
  "topics"
);

setupCrud(
  "questions",
  "questions"
);

setupCrud(
  "test-series",
  "test_series"
);

setupCrud(
  "mock-tests",
  "mock_tests"
);

app.get(
  "/api/admin/live-tests",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const snapshot = await db
        .collection("live_tests")
        .get();

      const items = snapshot.docs.map(serializeLiveTest);
      items.sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")));

      return res.json(items);
    } catch (error) {
      console.error("[Admin GET live-tests] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to load live tests.",
      });
    }
  }
);

app.get(
  "/api/admin/live-tests/:id",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id = String(req.params.id || "").trim();
      if (!validateDocumentId(id)) {
        return res.status(400).json({
          success: false,
          error: "Valid live test ID is required.",
        });
      }

      const reference = db.collection("live_tests").doc(id);
      const snapshot = await reference.get();

      if (!snapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Live test not found.",
        });
      }

      const data = snapshot.data() || {};
      return res.json(serializeLiveTest(snapshot));
    } catch (error) {
      console.error("[Admin GET live-test] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to load live test.",
      });
    }
  }
);

app.post(
  "/api/admin/live-tests",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const body = req.body || {};
      if (typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body.",
        });
      }

      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const startDate = normalizeLiveTestDate(body.startDate || "");
      const startTime = normalizeLiveTestTime(body.startTime || "");
      const endDate = normalizeLiveTestDate(body.endDate || "");
      const endTime = normalizeLiveTestTime(body.endTime || "");
      const published = body.published === true || body.published === "published" || body.published === "PUBLISHED";
      const questions = Array.isArray(body.questions) ? body.questions : [];

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Live test title is required.",
        });
      }

      const startAt = combineLiveTestDateTime(startDate, startTime);
      const endAt = combineLiveTestDateTime(endDate, endTime);
      if (!startAt || !endAt) {
        return res.status(400).json({
          success: false,
          error: "Valid start and end dates and times are required.",
        });
      }

      if (endAt.getTime() <= startAt.getTime()) {
        return res.status(400).json({ success: false, error: "End date and time must be after the start date and time." });
      }

      const validationErrors = [];
      const normalizedQuestions = questions.map((question, index) => {
        const result = validateLiveTestQuestion(question, index + 1);
        validationErrors.push(...result.errors);
        return result.question;
      });
      if (!normalizedQuestions.length) validationErrors.push("CSV Questions: at least one question is required.");
      if (validationErrors.length) {
        return res.status(400).json({ success: false, error: "Question validation failed.", errors: validationErrors });
      }

      const existingSnapshot = await db.collection("live_tests").get();
      const generatedId = buildUniqueLiveTestId(title, existingSnapshot.docs.map((doc) => doc.id));

      if (!generatedId) {
        return res.status(400).json({
          success: false,
          error: "Unable to generate a valid live test ID from the title.",
        });
      }

      const now = Timestamp.now();
      const payload = {
        id: generatedId,
        title,
        description,
        startDate,
        startTime,
        endDate,
        endTime,
        startAt: Timestamp.fromDate(startAt),
        endAt: Timestamp.fromDate(endAt),
        published,
        questionCount: normalizedQuestions.length,
        createdAt: now,
        updatedAt: now,
      };

      const reference = db.collection("live_tests").doc(generatedId);
      const batch = db.batch();
      batch.set(reference, payload);
      normalizedQuestions.forEach((question, index) => {
        batch.set(reference.collection("questions").doc(`question-${String(index + 1).padStart(4, "0")}`), {
          ...question,
          order: index + 1,
          createdAt: now,
          updatedAt: now,
        });
      });
      await batch.commit();

      return res.status(201).json({
        success: true,
        id: generatedId,
        data: payload,
        questionCount: normalizedQuestions.length,
      });
    } catch (error) {
      console.error("[Admin POST live-tests] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to create live test.",
      });
    }
  }
);

app.patch(
  "/api/admin/live-tests/:id",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id = String(req.params.id || "").trim();
      if (!validateDocumentId(id)) {
        return res.status(400).json({
          success: false,
          error: "Valid live test ID is required.",
        });
      }

      const reference = db.collection("live_tests").doc(id);
      const existingSnapshot = await reference.get();
      if (!existingSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Live test not found.",
        });
      }

      const body = req.body || {};
      if (typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body.",
        });
      }

      const existingData = existingSnapshot.data() || {};
      const title = String(body.title || existingData.title || "").trim();
      const description = String(body.description || existingData.description || "").trim();
      const startDate = normalizeLiveTestDate(body.startDate || existingData.startDate || "");
      const startTime = normalizeLiveTestTime(body.startTime || existingData.startTime || "");
      const endDate = normalizeLiveTestDate(body.endDate || existingData.endDate || "");
      const endTime = normalizeLiveTestTime(body.endTime || existingData.endTime || "");
      const published = body.published === true || body.published === "published" || body.published === "PUBLISHED" || (body.published === undefined && Boolean(existingData.published));

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Live test title is required.",
        });
      }

      const startAt = combineLiveTestDateTime(startDate, startTime);
      const endAt = combineLiveTestDateTime(endDate, endTime);
      if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
        return res.status(400).json({
          success: false,
          error: "End date and time must be after the start date and time.",
        });
      }

      let normalizedQuestions = null;
      if (Array.isArray(body.questions)) {
        const validationErrors = [];
        normalizedQuestions = body.questions.map((question, index) => {
          const result = validateLiveTestQuestion(question, index + 1);
          validationErrors.push(...result.errors);
          return result.question;
        });
        if (!normalizedQuestions.length) validationErrors.push("Questions: at least one question is required.");
        if (validationErrors.length) {
          return res.status(400).json({ success: false, error: "Question validation failed.", errors: validationErrors });
        }
      }

      const currentData = existingData;
      const payload = {
        ...currentData,
        ...body,
        id,
        title,
        description,
        startDate,
        startTime,
        endDate,
        endTime,
        startAt: Timestamp.fromDate(startAt),
        endAt: Timestamp.fromDate(endAt),
        published,
        updatedAt: Timestamp.now(),
      };

      delete payload.createdAt;
      await reference.set(payload, { merge: false });

      if (normalizedQuestions) {
        const oldQuestions = await reference.collection("questions").get();
        const batch = db.batch();
        oldQuestions.docs.forEach((question) => batch.delete(question.ref));
        normalizedQuestions.forEach((question, index) => {
          batch.set(reference.collection("questions").doc(`question-${String(index + 1).padStart(4, "0")}`), {
            ...question,
            order: index + 1,
            updatedAt: Timestamp.now(),
          });
        });
        batch.update(reference, { questionCount: normalizedQuestions.length, updatedAt: Timestamp.now() });
        await batch.commit();
      }

      return res.json({
        success: true,
        id,
        data: payload,
      });
    } catch (error) {
      console.error("[Admin PATCH live-tests] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to update live test.",
      });
    }
  }
);

app.delete(
  "/api/admin/live-tests/:id",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id = String(req.params.id || "").trim();
      if (!validateDocumentId(id)) {
        return res.status(400).json({
          success: false,
          error: "Valid live test ID is required.",
        });
      }

      const reference = db.collection("live_tests").doc(id);
      const snapshot = await reference.get();
      if (!snapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Live test not found.",
        });
      }

      const descendants = await collectDocumentTreeReferences(reference);
      await deleteDocumentTree(reference);

      await verifyDocumentDeleted(reference, "live-tests", id);
      await verifyDocumentTreeDeleted(reference, "live-tests", id);

      return res.json({
        success: true,
        id,
        deletedId: id,
        deletedChildren: descendants.length,
      });
    } catch (error) {
      console.error("[Admin DELETE live-tests] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to delete live test.",
      });
    }
  }
);

app.get("/api/admin/live-tests/:id/questions", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const id = String(req.params.id || "").trim();
    const reference = db.collection("live_tests").doc(id);
    if (!(await reference.get()).exists) return res.status(404).json({ success: false, error: "Live test not found." });
    const snapshot = await reference.collection("questions").orderBy("order").get();
    return res.json(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to load live test questions." });
  }
});

app.post("/api/admin/live-tests/:id/questions/import", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const id = String(req.params.id || "").trim();
    const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
    const reference = db.collection("live_tests").doc(id);
    if (!(await reference.get()).exists) return res.status(404).json({ success: false, error: "Live test not found." });
    const errors = [];
    const normalized = questions.map((question, index) => {
      const result = validateLiveTestQuestion(question, index + 1);
      errors.push(...result.errors);
      return result.question;
    });
    if (!normalized.length) errors.push("Questions: at least one question is required.");
    if (errors.length) return res.status(400).json({ success: false, error: "Question validation failed.", errors });
    const oldQuestions = await reference.collection("questions").get();
    const batch = db.batch();
    oldQuestions.docs.forEach((question) => batch.delete(question.ref));
    normalized.forEach((question, index) => batch.set(reference.collection("questions").doc(`question-${String(index + 1).padStart(4, "0")}`), { ...question, order: index + 1, updatedAt: Timestamp.now() }));
    batch.update(reference, { questionCount: normalized.length, updatedAt: Timestamp.now() });
    await batch.commit();
    return res.json({ success: true, questionCount: normalized.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to import live test questions." });
  }
});

app.delete("/api/admin/live-tests/:id/questions/:questionId", async (req, res) => {
  try {
    if (!requireDb(res)) return;

    const liveTestId = String(req.params.id || "").trim();
    const questionId = String(req.params.questionId || "").trim();

    if (!validateDocumentId(liveTestId) || !validateDocumentId(questionId)) {
      return res.status(400).json({
        success: false,
        error: "Valid live test and question IDs are required.",
      });
    }

    const reference = db.collection("live_tests").doc(liveTestId);
    const questionReference = reference.collection("questions").doc(questionId);
    const questionSnapshot = await questionReference.get();

    if (!questionSnapshot.exists) {
      return res.status(404).json({
        success: false,
        error: "Live test question not found.",
      });
    }

    await questionReference.delete();
    await verifyDocumentDeleted(
      questionReference,
      "live-test-question",
      questionId
    );

    const remainingQuestions = await reference.collection("questions").count().get();
    await reference.update({
      questionCount: Number(remainingQuestions.data().count || 0),
      updatedAt: Timestamp.now(),
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to delete live test question." });
  }
});

app.get(
  "/api/admin/live-tests/:id/participants",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id = String(req.params.id || "").trim();
      if (!validateDocumentId(id)) {
        return res.status(400).json({
          success: false,
          error: "Valid live test ID is required.",
        });
      }

      const liveTestSnapshot = await db.collection("live_tests").doc(id).get();
      if (!liveTestSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Live test not found.",
        });
      }

      const liveTestData = liveTestSnapshot.data() || {};
      const eligibleResults = await db.collection("results").get();
      const rows = eligibleResults.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .filter((result) => result.liveTestId === id)
        .sort((a, b) => {
          const scoreA = Number(a.score || 0);
          const scoreB = Number(b.score || 0);
          return scoreB - scoreA;
        });

      return res.json(rows);
    } catch (error) {
      console.error("[Admin GET live-test participants] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to load live test participants.",
      });
    }
  }
);

app.get(
  "/api/admin/live-tests/:id/leaderboard",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id = String(req.params.id || "").trim();
      if (!validateDocumentId(id)) {
        return res.status(400).json({
          success: false,
          error: "Valid live test ID is required.",
        });
      }

      const liveTestSnapshot = await db.collection("live_tests").doc(id).get();
      if (!liveTestSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Live test not found.",
        });
      }

      const liveTestData = liveTestSnapshot.data() || {};
      const eligibleResults = await db.collection("results").get();
      const rows = eligibleResults.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .filter((result) => {
          if (result.liveTestId !== id) {
            return false;
          }

          const status = String(result.status || "").toLowerCase();
          const isSuccessful =
            status === "completed" ||
            status === "success" ||
            status === "submitted" ||
            result.submittedAt ||
            Number.isFinite(Number(result.score));

          return isSuccessful;
        })
        .sort((a, b) => {
          const scoreA = Number(a.score || 0);
          const scoreB = Number(b.score || 0);
          return scoreB - scoreA;
        });

      return res.json(rows);
    } catch (error) {
      console.error("[Admin GET live-test leaderboard] Failed:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to load leaderboard.",
      });
    }
  }
);

// ============================================================
// STUDENT LIVE TEST API
// ============================================================

app.get("/api/live-tests", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const snapshot = await db.collection("live_tests").where("published", "==", true).get();
    return res.json(snapshot.docs.map(serializeLiveTest));
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to load live tests." });
  }
});

app.get("/api/live-tests/:id", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const snapshot = await db.collection("live_tests").doc(String(req.params.id || "")).get();
    if (!snapshot.exists || snapshot.data()?.published !== true) return res.status(404).json({ success: false, error: "Live test not found." });
    return res.json(serializeLiveTest(snapshot));
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to load live test." });
  }
});

app.get("/api/live-tests/:id/questions", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const liveTest = await db.collection("live_tests").doc(String(req.params.id || "")).get();
    if (!liveTest.exists || liveTest.data()?.published !== true) return res.status(404).json({ success: false, error: "Live test not found." });
    const data = liveTest.data() || {};
    if (getLiveTestAutoStatus(data) !== "LIVE NOW") return res.status(403).json({ success: false, error: "Questions are available only while the live test is active." });
    const snapshot = await liveTest.ref.collection("questions").orderBy("order").get();
    return res.json(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to load live test questions." });
  }
});

app.post("/api/live-tests/:id/submit", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const liveTestId = String(req.params.id || "").trim();
    const userId = String(req.body?.userId || "").trim();
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const liveTest = await db.collection("live_tests").doc(liveTestId).get();
    if (!liveTest.exists || liveTest.data()?.published !== true) return res.status(404).json({ success: false, error: "Live test not found." });
    if (getLiveTestAutoStatus(liveTest.data()) !== "LIVE NOW") return res.status(403).json({ success: false, error: "This live test is not currently active." });

    const questionSnapshot = await liveTest.ref.collection("questions").get();
    const questions = questionSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const questionMap = new Map(questions.map((question) => [question.id, question]));
    const correct = answers.reduce((count, answer) => {
      const question = questionMap.get(String(answer?.questionId || answer?.id || ""));
      return count + (question && String(answer?.answer || answer?.selectedAnswer || "").toUpperCase() === question.correctAnswer ? 1 : 0);
    }, 0);
    const result = {
      userId,
      liveTestId,
      score: correct,
      totalQuestions: questions.length,
      submittedAt: Timestamp.now(),
      status: "submitted",
    };
    const resultReference = db.collection("results").doc();
    await resultReference.set(result);
    return res.status(201).json({ success: true, id: resultReference.id, data: { ...result, id: resultReference.id } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to submit live test." });
  }
});

app.get("/api/live-tests/:id/leaderboard", async (req, res) => {
  try {
    if (!requireDb(res)) return;
    const liveTest = await db.collection("live_tests").doc(String(req.params.id || "")).get();
    if (!liveTest.exists || getLiveTestAutoStatus(liveTest.data()) !== "ENDED") return res.status(403).json({ success: false, error: "Leaderboard is available after the live test ends." });
    const snapshot = await db.collection("results").where("liveTestId", "==", liveTest.id).get();
    const rows = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return res.json(rows.map((row, index) => ({ ...row, rank: index + 1 })));
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to load leaderboard." });
  }
});

setupCrud(
  "results",
  "results"
);

setupCrud(
  "notes",
  "pdf_notes"
);

setupCrud(
  "current-affairs",
  "current_affairs"
);

// ============================================================
// NOTIFICATIONS
// ============================================================

app.get(
  "/api/admin/notifications",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      try {
        const snapshot =
          await db
            .collection(
              "notifications"
            )
            .orderBy(
              "createdAt",
              "desc"
            )
            .get();

        const notifications =
          snapshot.docs.map(
            (doc) => ({
              ...doc.data(),
              id: doc.id,
            })
          );

        return res.json(
          notifications
        );
      } catch (orderedError) {
        console.warn(
          "[Admin GET notifications] Ordered query failed, using fallback:",
          orderedError?.message
        );

        const snapshot =
          await db
            .collection(
              "notifications"
            )
            .get();

        const notifications =
          snapshot.docs.map(
            (doc) => ({
              ...doc.data(),
              id: doc.id,
            })
          );

        notifications.sort(
          (a, b) => {
            const aTime =
              a.createdAt?.toMillis?.() ||
              0;

            const bTime =
              b.createdAt?.toMillis?.() ||
              0;

            return (
              bTime - aTime
            );
          }
        );

        return res.json(
          notifications
        );
      }
    } catch (error) {
      console.error(
        "[Admin GET notifications] Failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Failed to load notifications.",
      });
    }
  }
);

// ============================================================
// CREATE NOTIFICATION
// ============================================================

app.post(
  "/api/admin/notifications",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const body =
        req.body || {};

      if (
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid request body.",
        });
      }

      const title =
        typeof body.title === "string"
          ? body.title.trim()
          : "";

      const message =
        typeof body.message === "string"
          ? body.message.trim()
          : "";

      const type =
        typeof body.type === "string"
          ? body.type.trim()
          : "all";

      const targetExamId =
        typeof body.targetExamId === "string"
          ? body.targetExamId.trim()
          : "";

      const linkUrl =
        typeof body.linkUrl === "string"
          ? body.linkUrl.trim()
          : "";

      if (!title) {
        return res.status(400).json({
          success: false,
          error:
            "Notification title is required.",
        });
      }

      if (!message) {
        return res.status(400).json({
          success: false,
          error:
            "Notification message is required.",
        });
      }

      const allowedTypes = [
        "all",
        "premium",
        "exam",
      ];

      if (
        !allowedTypes.includes(type)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid notification target type.",
        });
      }

      if (type === "exam") {
        if (
          !targetExamId ||
          !validateDocumentId(
            targetExamId
          )
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Valid targetExamId is required for exam notifications.",
          });
        }

        const examSnapshot =
          await db
            .collection("exams")
            .doc(targetExamId)
            .get();

        if (!examSnapshot.exists) {
          return res.status(404).json({
            success: false,
            error:
              "Selected exam does not exist.",
          });
        }
      }

      if (linkUrl) {
        try {
          const parsedUrl =
            new URL(linkUrl);

          if (
            ![
              "http:",
              "https:",
            ].includes(
              parsedUrl.protocol
            )
          ) {
            throw new Error(
              "Invalid protocol"
            );
          }
        } catch {
          return res.status(400).json({
            success: false,
            error:
              "linkUrl must be a valid HTTP or HTTPS URL.",
          });
        }
      }

      const reference =
        db
          .collection(
            "notifications"
          )
          .doc();

      const now =
        Timestamp.now();

      const payload = {
        id:
          reference.id,

        title,

        message,

        type,

        targetExamId:
          type === "exam"
            ? targetExamId
            : "",

        linkUrl,

        status:
          "saved",

        createdAt:
          now,

        updatedAt:
          now,
      };

      await reference.set(
        payload
      );

      console.log(
        `[Admin Notification] Saved: ${reference.id}`
      );

      return res.status(201).json({
        success: true,
        id:
          reference.id,
        data:
          payload,
        status:
          "saved",
      });
    } catch (error) {
      console.error(
        "[Admin POST notifications] Failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Failed to save notification.",
      });
    }
  }
);

// ============================================================
// DELETE NOTIFICATION
// ============================================================

app.delete(
  "/api/admin/notifications/:id",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const id =
        req.params.id;

      if (
        !id ||
        !validateDocumentId(id)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Valid notification ID is required.",
        });
      }

      const reference =
        db
          .collection(
            "notifications"
          )
          .doc(id);

      const snapshot =
        await reference.get();

      if (!snapshot.exists) {
        return res.status(404).json({
          success: false,
          error:
            "Notification not found.",
        });
      }

      await reference.delete();

      await verifyDocumentDeleted(
        reference,
        "notifications",
        id
      );

      console.log(
        `[Admin Notification] Deleted: ${id}`
      );

      return res.json({
        success: true,
        id,
      });
    } catch (error) {
      console.error(
        "[Admin DELETE notifications] Failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Failed to delete notification.",
      });
    }
  }
);

// ============================================================
// SETTINGS
// ============================================================

app.get(
  "/api/admin/settings",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const settings =
        await getCollection(
          "settings"
        );

      const appSettings =
        settings.find(
          (s) =>
            s.id ===
            "app_settings"
        ) || {};

      res.json({
        platformName:
          "RankHub Exam Prep",

        currency:
          "INR",

        ...appSettings,
      });
    } catch (error) {
      console.error(
        "[Admin Settings GET] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Failed to load settings.",
      });
    }
  }
);

app.post(
  "/api/admin/settings",
  async (req, res) => {
    try {
      if (!requireDb(res)) return;

      const payload = {
        ...req.body,
        updatedAt:
          Timestamp.now(),
      };

      await setDocument(
        "settings",
        "app_settings",
        payload
      );

      res.json({
        success: true,
        data:
          payload,
      });
    } catch (error) {
      console.error(
        "[Admin Settings POST] Failed:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Failed to save settings.",
      });
    }
  }
);

// ============================================================
// API 404
// ============================================================

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  }
);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "[RankHub Server Error]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Internal server error.",
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[RankHub Server] Uncaught exception:",
      error
    );

    process.exitCode = 1;
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "[RankHub Server] Unhandled promise rejection:",
      reason
    );

    process.exitCode = 1;
  }
);

const server = app.listen(
  PORT,
  () => {
    console.log(
      `[RankHub Admin Server] Running on port ${PORT}`
    );

    console.log(
      `[RankHub Admin Server] Project: ${PROJECT_ID}`
    );

    console.log(
      "[RankHub Admin Server] Exam collection: exams"
    );

    console.log(
      "[RankHub Admin Server] Subject collection: exams/{examId}/subjects"
    );

    console.log(
      "[RankHub Admin Server] Topic collection: exams/{examId}/subjects/{subjectId}/topics"
    );

    console.log(
      "[RankHub Admin Server] Test Series collection: exams/{examId}/test_series"
    );

    console.log(
      "[RankHub Admin Server] Mock Test collection: exams/{examId}/mock_tests"
    );

    console.log(
      "[RankHub Admin Server] PYQ collection: exams/{examId}/pyq"
    );
  }
);

server.on(
  "error",
  (error) => {
    console.error(
      `[RankHub Admin Server] HTTP listener failed on port ${PORT}:`,
      error
    );
  }
);