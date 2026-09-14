// =============================================================
// RANKHUB ADMIN — CENTRALIZED API & FIRESTORE GATEWAY
// =============================================================

export { generateIdFromName } from './id-utils.js';
//
// Admin API:
// http://localhost:3000
//
// IMPORTANT:
// - Admin frontend talks to Express Admin API.
// - Firestore access for Admin remains server-side.
// - No demo/fake data is created here.
// - Current Affairs is COMMON across all exams.
// - Current Affairs has NO examId.
// - Mock Tests support Exam Stage / Tier.
// =============================================================


// =============================================================
// API CONFIG
// =============================================================

const configuredApiBaseUrl =
  typeof globalThis.RANKHUB_API_BASE_URL === 'string'
    ? globalThis.RANKHUB_API_BASE_URL.trim()
    : '';

const browserApiBaseUrl =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';

const API_BASE_URL = (
  configuredApiBaseUrl || browserApiBaseUrl
).replace(/\/+$/, '');

const dataChangeChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('rankhub-admin-data-change')
  : null;

function notifyDataChanged(detail) {
  const eventDetail = {
    ...detail,
    occurredAt: Date.now()
  };

  window.dispatchEvent(new CustomEvent('rankhub:data-changed', {
    detail: eventDetail
  }));
  dataChangeChannel?.postMessage(eventDetail);
}


// =============================================================
// BASE API FETCH
// =============================================================

async function apiFetch(endpoint, options = {}) {

  const {
    allowFailureResponse = false,
    ...fetchOptions
  } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {})
  };

  const fullUrl =
    endpoint.startsWith('http')
      ? endpoint
      : API_BASE_URL
        ? `${API_BASE_URL}${endpoint}`
        : endpoint;

  let response;

  try {

    response = await fetch(fullUrl, {
      credentials: 'include',
      ...fetchOptions,
      headers
    });

  } catch (error) {

    console.error(
      'RankHub Admin API connection error:',
      error
    );

    throw new Error(
      'Failed to fetch Admin API: server unavailable'
    );

  }

  if (!response.ok) {

    let errorMsg =
      `Server returned status ${response.status}`;

    try {

      const errData =
        await response.json();

      errorMsg =
        errData.message ||
        errData.error ||
        errorMsg;

    } catch (parseError) {

      errorMsg =
        `Admin API error: ${response.status}`;

    }

    throw new Error(errorMsg);

  }

  const contentType =
    response.headers.get('content-type') || '';

  if (
    contentType.includes('application/json')
  ) {
    const data = await response.json();

    if (!allowFailureResponse && data && data.success === false) {
      throw new Error(data.message || data.error || 'Admin API operation failed.');
    }

    if (
      !allowFailureResponse &&
      fetchOptions.method === 'DELETE' &&
      data?.success !== true
    ) {
      throw new Error('Admin API did not confirm the deletion.');
    }

    if (fetchOptions.method === 'DELETE' && data?.success === true) {
      notifyDataChanged({
        method: 'DELETE',
        endpoint,
        response: data
      });
    }

    return data;

  }

  return await response.text();

}

export async function bulkDeleteFirestoreRecords(
  resource,
  ids,
  examId = null,
  subjectId = null
) {
  try {
    // ---------------------------------------------------------
    // Validate IDs
    // ---------------------------------------------------------
    if (!resource) {
      throw new Error('Bulk delete resource is required.');
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('At least one record ID is required for bulk delete.');
    }

    // ---------------------------------------------------------
    // Fallback: read scope from current page URL
    // ---------------------------------------------------------
    const params = new URLSearchParams(window.location.search);

    const resolvedExamId =
      examId ||
      params.get('examId') ||
      null;

    const resolvedSubjectId =
      subjectId ||
      params.get('subjectId') ||
      null;

    // ---------------------------------------------------------
    // Nested Firestore resources
    // ---------------------------------------------------------
    const nestedResources = [
      'subjects',
      'topics',
      'test-series',
      'mock-tests',
      'pyqs'
    ];

    const isNestedResource =
      nestedResources.includes(resource);

    // ---------------------------------------------------------
    // Required scope validation
    // ---------------------------------------------------------
    if (isNestedResource && !resolvedExamId) {
      throw new Error(
        'examId is required for nested bulk delete.'
      );
    }

    if (
      resource === 'topics' &&
      !resolvedSubjectId
    ) {
      throw new Error(
        'subjectId is required for topic bulk delete.'
      );
    }

    // ---------------------------------------------------------
    // Query scope
    // ---------------------------------------------------------
    const query = new URLSearchParams();

    if (resolvedExamId) {
      query.set(
        'examId',
        resolvedExamId
      );
    }

    if (resolvedSubjectId) {
      query.set(
        'subjectId',
        resolvedSubjectId
      );
    }

    // ---------------------------------------------------------
    // IMPORTANT:
    // Send scope BOTH in request body AND header.
    // This supports the current backend and prevents
    // examId-scope errors.
    // ---------------------------------------------------------
    const body = {
      ids
    };

    if (resolvedExamId) {
      body.examId =
        resolvedExamId;
    }

    if (resolvedSubjectId) {
      body.subjectId =
        resolvedSubjectId;
    }

    // ---------------------------------------------------------
    // Bulk delete API
    // ---------------------------------------------------------
    return await apiFetch(
      `/api/admin/${encodeURIComponent(resource)}/bulk`,
      {
        method: 'DELETE',

        allowFailureResponse: true,

        headers: {
          'X-Admin-Scope':
            query.toString()
        },

        body:
          JSON.stringify(body)
      }
    );

  } catch (error) {

    console.error(
      `[RankHub Bulk Delete] ${resource}:`,
      error
    );

    throw error;
  }
}


// =============================================================
// 1. DASHBOARD STATS
// =============================================================

export async function getDashboardStats() {

  try {

    return await apiFetch(
      '/api/admin/stats'
    );

  } catch (err) {

    console.error(
      'Error fetching dashboard stats from Admin API:',
      err
    );

    throw err;

  }

}


// =============================================================
// 2. USERS CRUD
// =============================================================

export async function getFirestoreUsers() {

  try {

    return await apiFetch(
      '/api/admin/users'
    );

  } catch (e) {

    console.error(
      'Failed to get users:',
      e
    );

    return [];

  }

}


export async function updateUserStatus(
  userId,
  status
) {

  try {

    return await apiFetch(
      `/api/admin/users/${encodeURIComponent(userId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status
        })
      }
    );

  } catch (e) {

    console.error(
      `Failed to update status for user ${userId}:`,
      e
    );

    throw e;

  }

}


export async function toggleUserPremium(
  userId,
  isPremium,
  validityDays = 30
) {

  try {

    return await apiFetch(
      `/api/admin/users/${encodeURIComponent(userId)}/premium`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          isPremium,
          validityDays
        })
      }
    );

  } catch (e) {

    console.error(
      `Failed to update premium for user ${userId}:`,
      e
    );

    throw e;

  }

}


export async function saveUser(
  userData
) {

  try {

    const res =
      await apiFetch(
        '/api/admin/users',
        {
          method: 'POST',
          body: JSON.stringify(
            userData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save user:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreUser(
  userId
) {

  try {

    await apiFetch(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete user ${userId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 3. EXAMS CRUD
// =============================================================
//
// Exam structure can contain:
//
// {
//   id,
//   name,
//   code,
//   category,
//   order,
//   status,
//   description,
//
//   stages: [
//     {
//       id,
//       name,
//       code,
//       order,
//       status
//     }
//   ]
// }
//
// OR legacy/simple format:
//
// stages: [
//   "Tier 1",
//   "Tier 2"
// ]
//
// OR:
//
// stage: "Tier 1"
//
// This file does NOT create stages.
// It simply sends/receives the data through the Admin API.
// =============================================================

export async function getFirestoreExams() {

  try {

    const exams =
      await apiFetch(
        '/api/admin/exams'
      );

    if (!Array.isArray(exams)) {
      return [];
    }

    exams.sort(
      (a, b) =>
        (Number(a.order) || 99) -
        (Number(b.order) || 99)
    );

    return exams;

  } catch (e) {

    console.error(
      'Failed to get exams:',
      e
    );

    throw e;

  }

}


export async function saveExam(
  examData
) {

  try {

    // ---------------------------------------------------------
    // Preserve Stage / Tier data if provided.
    // ---------------------------------------------------------

    const payload = {
      ...examData,

      stages:
        Array.isArray(examData?.stages)
          ? examData.stages
          : undefined,

      stage:
        examData?.stage
          ? String(
              examData.stage
            ).trim()
          : null
    };


    const res =
      await apiFetch(
        '/api/admin/exams',
        {
          method: 'POST',
          body: JSON.stringify(
            payload
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save exam:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreExam(
  examId
) {

  try {

    const response = await apiFetch(
      `/api/admin/exams/${encodeURIComponent(examId)}`,
      {
        method: 'DELETE'
      }
    );

    if (!response || response.success !== true) {
      throw new Error(response?.error || 'Exam delete failed.');
    }

    return response;

  } catch (e) {

    console.error(
      `Failed to delete exam ${examId}:`,
      e
    );

    throw e;

  }

}


async function getExamScopedRecords(
  endpoint,
  examId,
  query = ''
) {
  if (examId) {
    const suffix = query
      ? `&${query}`
      : '';

    return apiFetch(
      `${endpoint}?examId=${encodeURIComponent(examId)}${suffix}`
    );
  }

  const exams = await getFirestoreExams();
  const records = await Promise.all(
    exams.map((exam) =>
      apiFetch(
        `${endpoint}?examId=${encodeURIComponent(exam.id)}${query ? `&${query}` : ''}`
      )
    )
  );

  return records.flat();
}


// =============================================================
// 4. SUBJECTS CRUD
// =============================================================

export async function getFirestoreSubjects(
  examId = null
) {

  try {

    let subjects = await getExamScopedRecords(
      '/api/admin/subjects',
      examId
    );

    if (!Array.isArray(subjects)) {
      subjects = [];
    }

    if (examId) {

      subjects =
        subjects.filter(
          subject =>
            subject.examId === examId
        );

    }

    subjects.sort(
      (a, b) =>
        (Number(a.order) || 99) -
        (Number(b.order) || 99)
    );

    return subjects;

  } catch (e) {

    console.error(
      'Failed to get subjects:',
      e
    );

    throw e;

  }

}


export async function saveSubject(
  subjectData
) {

  try {

    if (!subjectData?.examId) {
      throw new Error('examId is required to save a subject.');
    }

    const res =
      await apiFetch(
        '/api/admin/subjects',
        {
          method: 'POST',
          body: JSON.stringify(
            subjectData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save subject:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreSubject(
  subjectId,
  examId = null
) {

  try {

    if (!examId) {
      throw new Error('examId is required to delete a subject.');
    }

    const suffix =
      `?examId=${encodeURIComponent(examId)}`;

    await apiFetch(
      `/api/admin/subjects/${encodeURIComponent(subjectId)}${suffix}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete subject ${subjectId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 5. TOPICS CRUD
// =============================================================

export async function getFirestoreTopics(
  subjectId = null,
  examId = null
) {

  try {

    let topics = await getExamScopedRecords(
      '/api/admin/topics',
      examId
    );

    if (!Array.isArray(topics)) {
      topics = [];
    }

    if (subjectId) {

      topics =
        topics.filter(
          topic =>
            topic.subjectId === subjectId
        );

    }

    topics.sort(
      (a, b) =>
        (Number(a.order) || 99) -
        (Number(b.order) || 99)
    );

    return topics;

  } catch (e) {

    console.error(
      'Failed to get topics:',
      e
    );

    throw e;

  }

}


export async function saveTopic(
  topicData
) {

  try {

    const res =
      await apiFetch(
        '/api/admin/topics',
        {
          method: 'POST',
          body: JSON.stringify(
            topicData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save topic:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreTopic(
  topicId,
  examId = null,
  subjectId = null
) {

  try {

    if (!examId) {
      throw new Error('examId is required to delete a topic.');
    }

    if (!subjectId) {
      throw new Error('subjectId is required to delete a topic.');
    }

    const suffix =
      `?examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}`;

    await apiFetch(
      `/api/admin/topics/${encodeURIComponent(topicId)}${suffix}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete topic ${topicId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 6. QUESTIONS CRUD & BULK IMPORT
// =============================================================

export async function getFirestoreQuestions(
  filters = {}
) {

  try {

    const response =
      await apiFetch(
        '/api/admin/questions'
      );

    let questions;

    if (Array.isArray(response)) {

      questions =
        response;

    } else if (
      Array.isArray(
        response?.questions
      )
    ) {

      questions =
        response.questions;

    } else if (
      Array.isArray(
        response?.data
      )
    ) {

      questions =
        response.data;

    } else {

      throw new Error(
        'Admin API returned an invalid questions response.'
      );

    }


    if (filters.examId) {

      questions =
        questions.filter(
          question =>
            question.examId ===
            filters.examId
        );

    }


    if (filters.subjectId) {

      questions =
        questions.filter(
          question =>
            question.subjectId ===
            filters.subjectId
        );

    }


    if (filters.topicId) {

      questions =
        questions.filter(
          question =>
            question.topicId ===
            filters.topicId
        );

    }


    if (filters.type) {

      questions =
        questions.filter(
          question =>
            question.type ===
            filters.type
        );

    }


    if (filters.difficulty) {

      questions =
        questions.filter(
          question =>
            question.difficulty ===
            filters.difficulty
        );

    }


    return questions;

  } catch (e) {

    console.error(
      'Failed to get questions:',
      e
    );

    throw e;

  }

}


export async function saveQuestion(
  qData
) {

  try {

    const res =
      await apiFetch(
        '/api/admin/questions',
        {
          method: 'POST',
          body: JSON.stringify(
            qData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save question:',
      e
    );

    throw e;

  }

}


export async function bulkImportQuestions(
  questionsList
) {

  try {

    return await apiFetch(
      '/api/admin/questions/bulk',
      {
        method: 'POST',
        body: JSON.stringify({
          questions:
            questionsList
        })
      }
    );

  } catch (e) {

    console.error(
      'Bulk import error:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreQuestion(
  questionId
) {

  try {

    await apiFetch(
      `/api/admin/questions/${encodeURIComponent(questionId)}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete question ${questionId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 7. TEST SERIES CRUD
// =============================================================

export async function getFirestoreTestSeries(
  examId = null
) {

  try {

    let series = await getExamScopedRecords(
      '/api/admin/test-series',
      examId
    );

    if (!Array.isArray(series)) {
      series = [];
    }

    if (examId) {

      series =
        series.filter(
          item =>
            item.examId === examId
        );

    }

    return series;

  } catch (e) {

    console.error(
      'Failed to get test series:',
      e
    );

    throw e;

  }

}


export async function saveTestSeries(
  seriesData
) {

  try {

    if (!seriesData?.examId) {
      throw new Error('examId is required to save a test series.');
    }

    const res =
      await apiFetch(
        '/api/admin/test-series',
        {
          method: 'POST',
          body: JSON.stringify(
            seriesData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save test series:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreTestSeries(
  seriesId,
  examId = null
) {

  try {

    if (!examId) {
      throw new Error('examId is required to delete a test series.');
    }

    await apiFetch(
      `/api/admin/test-series/${encodeURIComponent(seriesId)}?examId=${encodeURIComponent(examId)}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete test series ${seriesId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 8. MOCK TESTS CRUD
// =============================================================
//
// Mock Test supports:
//
// examId
// stage
// stageName
// stageId
//
// Example:
//
// {
//   examId: "ssc-cgl",
//   stage: "Tier 1",
//   stageName: "Tier 1",
//   stageId: null
// }
//
// Existing Mock Tests without Stage remain valid.
// No LocalStorage is used.
// =============================================================

export async function getFirestoreMockTests(
  testSeriesId = null,
  examId = null
) {

  try {

    let mocks = await getExamScopedRecords(
      '/api/admin/mock-tests',
      examId
    );

    if (!Array.isArray(mocks)) {
      mocks = [];
    }


    if (testSeriesId) {

      mocks =
        mocks.filter(
          mock =>
            mock.testSeriesId ===
            testSeriesId
        );

    }


    if (examId) {

      mocks =
        mocks.filter(
          mock =>
            mock.examId ===
            examId
        );

    }


    return mocks;

  } catch (e) {

    console.error(
      'Failed to get mock tests:',
      e
    );

    throw e;

  }

}


export async function saveMockTest(
  mockData
) {

  try {

    // ---------------------------------------------------------
    // Normalize Stage / Tier fields.
    // ---------------------------------------------------------

    const rawStage =
      mockData?.stageName ??
      mockData?.stage ??
      '';

    const stageValue =
      rawStage &&
      typeof rawStage === 'object'
        ? rawStage.name ??
          rawStage.title ??
          rawStage.stage ??
          rawStage.stageName ??
          rawStage.label ??
          ''
        : rawStage;


    const stage =
      String(
        stageValue
      ).trim();


    const stageId =
      mockData?.stageId
        ? String(
            mockData.stageId
          ).trim()
        : null;


    const payload = {

      ...mockData,

      // Main stage field.
      stage:
        stage ||
        null,

      // Backward / frontend compatibility.
      stageName:
        stage ||
        null,

      // Optional stage ID.
      stageId:
        stageId ||
        null

    };


    const res =
      await apiFetch(
        '/api/admin/mock-tests',
        {
          method: 'POST',

          body:
            JSON.stringify(
              payload
            )
        }
      );


    return (
      res?.id ??
      mockData?.id ??
      null
    );

  } catch (e) {

    console.error(
      'Failed to save mock test:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreMockTest(
  mockId,
  examId = null
) {

  try {

    if (!examId) {
      throw new Error('examId is required to delete a mock test.');
    }

    const suffix =
      `?examId=${encodeURIComponent(examId)}`;


    await apiFetch(
      `/api/admin/mock-tests/${encodeURIComponent(mockId)}${suffix}`,
      {
        method: 'DELETE'
      }
    );


    return true;

  } catch (e) {

    console.error(
      `Failed to delete mock test ${mockId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// LIVE TESTS CRUD
// =============================================================

export async function getLiveTests() {
  try {
    const items = await apiFetch('/api/admin/live-tests');
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.error('Failed to get live tests:', e);
    throw e;
  }
}

export async function getLiveTest(liveTestId) {
  try {
    if (!liveTestId) {
      throw new Error('liveTestId is required.');
    }

    const item = await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}`);
    return item || null;
  } catch (e) {
    console.error(`Failed to get live test ${liveTestId}:`, e);
    throw e;
  }
}

export async function saveLiveTest(liveTestData) {
  try {
    if (liveTestData?.id) {
      return await updateLiveTest(liveTestData.id, liveTestData);
    }

    const res = await apiFetch('/api/admin/live-tests', {
      method: 'POST',
      body: JSON.stringify(liveTestData)
    });

    return res?.data || res || null;
  } catch (e) {
    console.error('Failed to save live test:', e);
    throw e;
  }
}

export async function updateLiveTest(liveTestId, liveTestData) {
  try {
    if (!liveTestId) {
      throw new Error('liveTestId is required.');
    }

    const res = await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}`, {
      method: 'PATCH',
      body: JSON.stringify(liveTestData)
    });

    return res?.data || res || null;
  } catch (e) {
    console.error(`Failed to update live test ${liveTestId}:`, e);
    throw e;
  }
}

export async function deleteLiveTest(liveTestId) {
  try {
    if (!liveTestId) {
      throw new Error('liveTestId is required.');
    }

    await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}`, {
      method: 'DELETE'
    });

    return true;
  } catch (e) {
    console.error(`Failed to delete live test ${liveTestId}:`, e);
    throw e;
  }
}

export async function getLiveTestQuestions(liveTestId) {
  if (!liveTestId) throw new Error('liveTestId is required.');
  const items = await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}/questions`);
  return Array.isArray(items) ? items : [];
}

export async function importLiveTestQuestions(liveTestId, questions) {
  if (!liveTestId) throw new Error('liveTestId is required.');
  return apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}/questions/import`, {
    method: 'POST',
    body: JSON.stringify({ questions })
  });
}

export async function deleteLiveTestQuestion(liveTestId, questionId) {
  if (!liveTestId || !questionId) throw new Error('liveTestId and questionId are required.');
  return apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}/questions/${encodeURIComponent(questionId)}`, {
    method: 'DELETE'
  });
}

export async function getLiveTestParticipants(liveTestId) {
  try {
    const items = await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}/participants`);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.error(`Failed to get participants for live test ${liveTestId}:`, e);
    throw e;
  }
}

export async function getLiveTestLeaderboard(liveTestId) {
  try {
    const items = await apiFetch(`/api/admin/live-tests/${encodeURIComponent(liveTestId)}/leaderboard`);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.error(`Failed to get leaderboard for live test ${liveTestId}:`, e);
    throw e;
  }
}


// =============================================================
// 9. RESULTS & SUBMISSIONS
// =============================================================

export async function getFirestoreResults(
  examId = null,
  userId = null
) {

  try {

    let results =
      await apiFetch(
        '/api/admin/results'
      );

    if (!Array.isArray(results)) {
      results = [];
    }


    if (examId) {

      results =
        results.filter(
          result =>
            result.examId ===
            examId
        );

    }


    if (userId) {

      results =
        results.filter(
          result =>
            result.userId ===
            userId
        );

    }


    return results;

  } catch (e) {

    console.error(
      'Failed to get results:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreResult(
  resultId
) {

  try {

    await apiFetch(
      `/api/admin/results/${encodeURIComponent(resultId)}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete result ${resultId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 10. STUDY NOTES CRUD
// =============================================================

export async function getFirestoreNotes(
  examId = null,
  subjectId = null
) {

  try {

    let notes =
      await apiFetch(
        '/api/admin/notes'
      );

    if (!Array.isArray(notes)) {
      notes = [];
    }


    if (examId) {

      notes =
        notes.filter(
          note =>
            note.examId ===
            examId
        );

    }


    if (subjectId) {

      notes =
        notes.filter(
          note =>
            note.subjectId ===
            subjectId
        );

    }


    return notes;

  } catch (e) {

    console.error(
      'Failed to get notes:',
      e
    );

    return [];

  }

}


export async function saveNote(
  noteData
) {

  try {

    const res =
      await apiFetch(
        '/api/admin/notes',
        {
          method: 'POST',
          body: JSON.stringify(
            noteData
          )
        }
      );

    return res.id;

  } catch (e) {

    console.error(
      'Failed to save note:',
      e
    );

    throw e;

  }

}


export async function deleteFirestoreNote(
  noteId
) {

  try {

    await apiFetch(
      `/api/admin/notes/${encodeURIComponent(noteId)}`,
      {
        method: 'DELETE'
      }
    );

    return true;

  } catch (e) {

    console.error(
      `Failed to delete note ${noteId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 11. PREVIOUS YEAR PAPERS / PYQ
// =============================================================

export async function getFirestorePYQ(
  examId = null,
  year = null
) {

  const params =
    new URLSearchParams();


  if (examId) {

    params.set(
      'examId',
      examId
    );

  }


  if (year) {

    params.set(
      'year',
      year
    );

  }


  const suffix =
    params.toString()
      ? `?${params.toString()}`
      : '';


  try {

    const result = examId
      ? await apiFetch(`/api/admin/pyq${suffix}`)
      : await getExamScopedRecords('/api/admin/pyq', null, year ? `year=${encodeURIComponent(year)}` : '');


    return Array.isArray(result)
      ? result
      : [];

  } catch (e) {

    console.error(
      'Failed to get PYQ:',
      e
    );

    throw e;

  }

}


export async function savePYQ(
  pyqData
) {

  try {

    const id =
      pyqData?.id;


    const res =
      await apiFetch(
        id
          ? `/api/admin/pyq/${encodeURIComponent(id)}`
          : '/api/admin/pyq',
        {
          method:
            id
              ? 'PUT'
              : 'POST',

          body:
            JSON.stringify(
              pyqData
            )
        }
      );


    return res.id;

  } catch (e) {

    console.error(
      'Failed to save PYQ:',
      e
    );

    throw e;

  }

}


export async function deleteFirestorePYQ(
  pyqId,
  examId = null
) {

  try {

    if (!examId) {
      throw new Error('examId is required to delete a PYQ.');
    }

    const suffix =
      `?examId=${encodeURIComponent(examId)}`;


    await apiFetch(
      `/api/admin/pyq/${encodeURIComponent(pyqId)}${suffix}`,
      {
        method: 'DELETE'
      }
    );


    return true;

  } catch (e) {

    console.error(
      `Failed to delete PYQ ${pyqId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 12. CURRENT AFFAIRS
// COMMON ACROSS ALL EXAMS
// =============================================================
//
// Firestore:
//
// current_affairs
//
// NO examId.
//
// Backend:
//
// POST /api/admin/current-affairs/generate
//
// Backend handles:
// - Reliable news
// - Important events
// - AI MCQ generation
// - Validation
// - Duplicate prevention
// - Deterministic IDs
// - Permanent storage
//
// No automatic deletion of old data.
// =============================================================


// =============================================================
// INDIA DATE
// =============================================================

function getIndiaDate() {

  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        'Asia/Kolkata'
    }
  ).format(
    new Date()
  );

}


// =============================================================
// NORMALIZE CURRENT AFFAIR
// =============================================================

function normalizeCurrentAffair(
  data = {}
) {

  const options =
    Array.isArray(data.options)
      ? data.options
          .map(
            option =>
              String(
                option ?? ''
              ).trim()
          )
      : [];


  let answerIndex = -1;


  if (
    Number.isInteger(
      data.answerIndex
    )
  ) {

    answerIndex =
      data.answerIndex;

  } else if (
    Number.isInteger(
      data.correctOption
    )
  ) {

    answerIndex =
      data.correctOption;

  } else if (
    typeof data.correctAnswer === 'number'
  ) {

    answerIndex =
      data.correctAnswer;

  } else if (
    typeof data.answerIndex === 'string' &&
    data.answerIndex.trim() !== ''
  ) {

    const parsed =
      Number(
        data.answerIndex
      );


    if (
      Number.isInteger(parsed)
    ) {

      answerIndex =
        parsed;

    }

  }


  // -----------------------------------------------------------
  // Support answer stored as option text.
  // -----------------------------------------------------------

  if (
    answerIndex < 0 ||
    answerIndex >= options.length
  ) {

    const answerText =
      String(
        data.answer ??
        data.correctAnswer ??
        data.correct_option ??
        ''
      ).trim().toLowerCase();


    if (answerText) {

      const foundIndex =
        options.findIndex(
          option =>
            String(
              option
            ).trim().toLowerCase() ===
            answerText
        );


      if (
        foundIndex >= 0
      ) {

        answerIndex =
          foundIndex;

      }

    }

  }


  if (
    answerIndex < 0 ||
    answerIndex >= options.length
  ) {

    answerIndex = -1;

  }


  return {

    ...data,

    id:
      data.id
        ? String(
            data.id
          ).trim()
        : (
            data.documentId
              ? String(
                  data.documentId
                ).trim()
              : null
          ),


    date:
      String(
        data.date ||
        getIndiaDate()
      ).trim(),


    question:
      String(
        data.question ||
        data.title ||
        ''
      ).trim(),


    options,


    answerIndex,


    explanation:
      String(
        data.explanation ||
        data.answerExplanation ||
        ''
      ).trim(),


    category:
      String(
        data.category ||
        'National'
      ).trim(),


    status:
      String(
        data.status ||
        'published'
      ).trim(),


    source:
      String(
        data.source ||
        ''
      ).trim(),


    sourceUrl:
      String(
        data.sourceUrl ||
        data.sourceURL ||
        ''
      ).trim()

  };

}


// =============================================================
// DETERMINISTIC CURRENT AFFAIR ID
// =============================================================

export function getNextCurrentAffairId(
  date,
  existingItems = []
) {

  const safeDate =
    String(
      date ||
      getIndiaDate()
    ).trim();


  const prefix =
    `ca_${safeDate.replaceAll('-', '_')}_`;


  let maxNumber = 0;


  for (
    const item of existingItems
  ) {

    const id =
      String(
        item?.id ||
        item?.documentId ||
        ''
      ).trim();


    if (
      !id.startsWith(prefix)
    ) {

      continue;

    }


    const suffix =
      id.slice(
        prefix.length
      );


    const number =
      Number.parseInt(
        suffix,
        10
      );


    if (
      Number.isInteger(number) &&
      number > maxNumber
    ) {

      maxNumber =
        number;

    }

  }


  return (
    `${prefix}` +
    `${String(
      maxNumber + 1
    ).padStart(
      3,
      '0'
    )}`
  );

}


// =============================================================
// GET CURRENT AFFAIRS
// =============================================================

export async function getFirestoreCurrentAffairs(
  category = null
) {

  try {

    let ca =
      await apiFetch(
        '/api/admin/current-affairs'
      );


    if (
      !Array.isArray(ca)
    ) {

      ca = [];

    }


    ca =
      ca.map(
        item =>
          normalizeCurrentAffair(
            item
          )
      );


    if (
      category &&
      category !== 'all'
    ) {

      ca =
        ca.filter(
          item =>
            item.category ===
            category
        );

    }


    // ---------------------------------------------------------
    // Latest date first.
    // Same date -> sequence ascending.
    // ---------------------------------------------------------

    ca.sort(
      (a, b) => {

        const dateCompare =
          String(
            b.date || ''
          ).localeCompare(
            String(
              a.date || ''
            )
          );


        if (
          dateCompare !== 0
        ) {

          return dateCompare;

        }


        return String(
          a.id || ''
        ).localeCompare(
          String(
            b.id || ''
          )
        );

      }
    );


    return ca;

  } catch (e) {

    console.error(
      'Failed to get current affairs:',
      e
    );

    throw e;

  }

}


// =============================================================
// SAVE CURRENT AFFAIR
// =============================================================

export async function saveCurrentAffair(
  caData
) {

  try {

    const payload =
      normalizeCurrentAffair(
        caData
      );


    // ---------------------------------------------------------
    // VALIDATION
    // ---------------------------------------------------------

    if (
      !payload.date
    ) {

      throw new Error(
        'Publication date is required.'
      );

    }


    if (
      !payload.question
    ) {

      throw new Error(
        'Question is required.'
      );

    }


    if (
      payload.options.length !== 4
    ) {

      throw new Error(
        'Exactly 4 options are required.'
      );

    }


    const hasEmptyOption =
      payload.options.some(
        option =>
          !String(
            option || ''
          ).trim()
      );


    if (
      hasEmptyOption
    ) {

      throw new Error(
        'All 4 options are required.'
      );

    }


    if (
      payload.answerIndex < 0 ||
      payload.answerIndex >=
        payload.options.length
    ) {

      throw new Error(
        'Please select the correct answer.'
      );

    }


    if (
      !payload.explanation
    ) {

      throw new Error(
        'Explanation is required.'
      );

    }


    // ---------------------------------------------------------
    // EDIT
    // ---------------------------------------------------------

    if (
      payload.id
    ) {

      const res =
        await apiFetch(
          `/api/admin/current-affairs/${encodeURIComponent(
            payload.id
          )}`,
          {
            method: 'PUT',

            body:
              JSON.stringify(
                payload
              )
          }
        );


      return (
        res?.id ||
        payload.id
      );

    }


    // ---------------------------------------------------------
    // CREATE
    // ---------------------------------------------------------

    const existing =
      await getFirestoreCurrentAffairs();


    const newId =
      getNextCurrentAffairId(
        payload.date,
        existing
      );


    payload.id =
      newId;


    const res =
      await apiFetch(
        '/api/admin/current-affairs',
        {
          method: 'POST',

          body:
            JSON.stringify(
              payload
            )
        }
      );


    return (
      res?.id ||
      newId
    );

  } catch (e) {

    console.error(
      'Failed to save current affair:',
      e
    );

    throw e;

  }

}


// =============================================================
// AUTO GENERATE CURRENT AFFAIRS
// =============================================================

export async function generateCurrentAffairs(
  options = {}
) {

  try {

    const date =
      String(
        options.date ||
        getIndiaDate()
      ).trim();


    const category =
      String(
        options.category ||
        'all'
      ).trim();


    if (
      !date
    ) {

      throw new Error(
        'Current Affairs date is required.'
      );

    }


    const payload = {
      date,
      category
    };


    const response =
      await apiFetch(
        '/api/admin/current-affairs/generate',
        {
          method: 'POST',

          body:
            JSON.stringify(
              payload
            )
        }
      );


    if (
      response === null ||
      response === undefined
    ) {

      throw new Error(
        'Current Affairs generator returned an empty response.'
      );

    }


    let generatedItems = [];


    if (
      Array.isArray(
        response
      )
    ) {

      generatedItems =
        response;

    } else if (
      Array.isArray(
        response.items
      )
    ) {

      generatedItems =
        response.items;

    } else if (
      Array.isArray(
        response.questions
      )
    ) {

      generatedItems =
        response.questions;

    } else if (
      response.question
    ) {

      generatedItems = [
        response
      ];

    }


    const validItems = [];


    for (
      const rawItem of generatedItems
    ) {

      const item =
        normalizeCurrentAffair(
          rawItem
        );


      if (
        !item.question
      ) {

        console.warn(
          'Skipping generated Current Affairs item: question missing.',
          rawItem
        );

        continue;

      }


      if (
        item.options.length !== 4
      ) {

        console.warn(
          'Skipping generated Current Affairs item: exactly 4 options required.',
          rawItem
        );

        continue;

      }


      if (
        item.answerIndex < 0 ||
        item.answerIndex >=
          item.options.length
      ) {

        console.warn(
          'Skipping generated Current Affairs item: correct answer missing.',
          rawItem
        );

        continue;

      }


      if (
        !item.explanation
      ) {

        console.warn(
          'Skipping generated Current Affairs item: explanation missing.',
          rawItem
        );

        continue;

      }


      validItems.push(
        item
      );

    }


    if (
      typeof response === 'object' &&
      !Array.isArray(response)
    ) {

      return {

        ...response,

        items:
          validItems,

        questions:
          validItems,

        generated:
          response.generated ??
          validItems.length,

        created:
          response.created ??
          validItems.length

      };

    }


    return {

      success: true,

      items:
        validItems,

      questions:
        validItems,

      generated:
        validItems.length,

      created:
        validItems.length

    };

  } catch (e) {

    console.error(
      'Failed to generate Current Affairs:',
      e
    );

    throw e;

  }

}


// =============================================================
// DELETE CURRENT AFFAIR
// =============================================================

export async function deleteFirestoreCurrentAffair(
  caId
) {

  try {

    if (
      !caId
    ) {

      throw new Error(
        'Current Affairs ID is required.'
      );

    }


    await apiFetch(
      `/api/admin/current-affairs/${encodeURIComponent(
        caId
      )}`,
      {
        method: 'DELETE'
      }
    );


    return true;

  } catch (e) {

    console.error(
      `Failed to delete current affair ${caId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 13. NOTIFICATIONS CRUD
// =============================================================

export async function getFirestoreNotifications() {

  try {

    const result =
      await apiFetch(
        '/api/admin/notifications'
      );


    return Array.isArray(result)
      ? result
      : [];

  } catch (e) {

    console.error(
      'Failed to get notifications:',
      e
    );

    return [];

  }

}


export async function saveNotification(
  notifData
) {

  try {

    const res =
      await apiFetch(
        '/api/admin/notifications',
        {
          method: 'POST',

          body:
            JSON.stringify(
              notifData
            )
        }
      );


    return res.id;

  } catch (e) {

    console.error(
      'Failed to save notification:',
      e
    );

    throw e;

  }

}


export const sendFirestoreNotification =
  saveNotification;


export async function deleteFirestoreNotification(
  notifId
) {

  try {

    await apiFetch(
      `/api/admin/notifications/${encodeURIComponent(notifId)}`,
      {
        method: 'DELETE'
      }
    );


    return true;

  } catch (e) {

    console.error(
      `Failed to delete notification ${notifId}:`,
      e
    );

    throw e;

  }

}


// =============================================================
// 14. PLATFORM SETTINGS
// =============================================================

export async function getPlatformSettings() {

  try {

    return await apiFetch(
      '/api/admin/settings'
    );

  } catch (e) {

    console.error(
      'Failed to get settings:',
      e
    );


    return {

      platformName:
        'RankHub Exam Prep',

      supportEmail:
        'support@rankhub.in',

      supportPhone:
        '+91 98765 43210',

      brandTagline:
        'Crack India’s Top Competitive Exams with Confidence',

      accentColor:
        '#e11d48',

      enableRegistration:
        true,

      enableMaintenanceMode:
        false,

      maintenanceMessage:
        'RankHub is undergoing scheduled maintenance.',

      currency:
        'INR'

    };

  }

}


export async function savePlatformSettings(
  settingsData
) {

  try {

    return await apiFetch(
      '/api/admin/settings',
      {
        method: 'POST',

        body:
          JSON.stringify(
            settingsData
          )
      }
    );

  } catch (e) {

    console.error(
      'Failed to save settings:',
      e
    );

    throw e;

  }

}


export const getFirestoreSettings =
  getPlatformSettings;


export const saveFirestoreSettings =
  savePlatformSettings;


// =============================================================
// END OF ADMIN-DB.JS
// =============================================================

