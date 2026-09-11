import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC7N6wW2L4TRsumAW2FI5Q2rBJUSnPY4RU",
  authDomain: "caisse-noire-hbc-langeac.firebaseapp.com",
  projectId: "caisse-noire-hbc-langeac",
  storageBucket: "caisse-noire-hbc-langeac.firebasestorage.app",
  messagingSenderId: "64451663313",
  appId: "1:64451663313:web:1dcf4921ea370e51edbcf0"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
