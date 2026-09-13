// Firebase Configuration and Initialization for RankHub Admin Panel
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  getCountFromServer
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// Kept for shared frontend configuration; database writes use the Admin API.
const defaultFirebaseConfig = {
  apiKey: "AIzaSyBNko7E9OJkzqFh7pDyyfsFKeDuYqaOJMw",
  authDomain: "rankhub-28aa8.firebaseapp.com",
  projectId: "rankhub-28aa8",
  storageBucket: "rankhub-28aa8.firebasestorage.app",
  messagingSenderId: "173659685964",
  appId: "1:173659685964:web:5c6980265389bb95b2e0e9",
  measurementId: "G-SKG99RP3XM"
};

const app = getApps().length === 0 ? initializeApp(defaultFirebaseConfig) : getApp();
export const db = getFirestore(app);

// Error Handling Helper conforming to Firestore Error Specifications
export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  return errInfo;
}

// Firestore Collection References
export const COLLECTIONS = {
  USERS: 'users',
  ADMINS: 'admins',
  EXAMS: 'exams',
  SUBJECTS: 'subjects',
  TOPICS: 'topics',
  QUESTIONS: 'questions',
  TEST_SERIES: 'test_series',
  MOCK_TESTS: 'mock_tests',
  RESULTS: 'results',
  NOTES: 'pdf_notes',
  PYQ: 'pyqs',
  CURRENT_AFFAIRS: 'current_affairs',
  NOTIFICATIONS: 'notifications',
  SETTINGS: 'settings'
};

export const EXAM_CHILD_COLLECTIONS = {
  SUBJECTS: 'subjects',
  MOCK_TESTS: 'mock_tests',
  PYQ: 'pyq',
  TEST_SERIES: 'test_series'
};

export function examCollectionPath(examId, childCollection) {
  if (!examId || !childCollection) {
    throw new Error('examId and childCollection are required.');
  }

  return `exams/${examId}/${childCollection}`;
}

// Export Firestore utilities
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getCountFromServer,
};
