"use client";
export type ThemePref = "light" | "dark" | "system";
const KEY = "pos:theme";

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref) || "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#15100c" : "#f1e8de");
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  applyTheme(pref);
}

/** Inline script (runs before hydration) to avoid a flash of the wrong theme. */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('${KEY}')||'dark';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;
