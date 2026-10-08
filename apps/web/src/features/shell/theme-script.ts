export const THEME_STORAGE_KEY = "bsd-theme";

/** Runs in <head> before paint; dark unless the user chose light. */
export const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem("${THEME_STORAGE_KEY}")==="light"?"light":"dark"}catch(e){}`;
