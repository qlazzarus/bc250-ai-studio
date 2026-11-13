const API_KEY = import.meta.env.VITE_STUDIO_API_KEY || sessionStorage.getItem("bc250.studio.token") || "";
const JOBS_PER_PAGE = 12;
const ASSETS_PER_PAGE = 12;

export { API_KEY, JOBS_PER_PAGE, ASSETS_PER_PAGE };