"use client";
export type ThemePref = "light" | "dark" | "system";
const KEY = "pos:theme";

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref) || "light";
  } catch {
    return "light";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0f14" : "#0f766e");
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  applyTheme(pref);
}

/** Inline script (runs before hydration) to avoid a flash of the wrong theme. */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('${KEY}')||'light';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;
