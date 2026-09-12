import axios from "axios";

// ======================================================
// API BASE URL
// ======================================================
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000/api"
      : "https://dental-backend-xojn.onrender.com/api"
  );

console.log("API Base URL:", API_BASE);

// ======================================================
// AXIOS INSTANCE
// ======================================================
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 300000, // 5 minutes
});

// ======================================================
// REQUEST INTERCEPTOR
// ======================================================
api.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    console.log(
      `➡️ ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
      config.data || config.params || ""
    );

    return config;
  },
  (error) => {
    console.error("Request Error:", error);
    return Promise.reject(error);
  }
);

// ======================================================
// RESPONSE INTERCEPTOR
// ======================================================
api.interceptors.response.use(
  (response) => {
    console.log(
      `✅ ${response.config.method?.toUpperCase()} ${response.config.url}`,
      response.data
    );

    return response;
  },
  (error) => {
    if (error.response) {
      console.error(
        "Server Error:",
        error.response.status,
        error.response.data
      );

      if (error.response.status === 401) {
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("role");
        sessionStorage.removeItem("username");

        if (window.location.pathname !== "/login") {
          alert("Session expired. Please login again.");
          window.location.href = "/login";
        }
      }
    } else if (error.request) {
      console.error("No response from backend.");

      if (!API_BASE.includes("localhost")) {
        alert("Backend is starting. Please wait 15–30 seconds and try again.");
      }
    } else {
      console.error("Axios Error:", error.message);
    }

    return Promise.reject(error);
  }
);

export default api;