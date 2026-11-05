"use client";

import { useEffect, useState } from "react";
import type { Department } from "../services/db/departments";
import { getNavigationDepartments } from "../services/db/departments";

/**
 * Departments that belong in the site's own navigation.
 *
 * Navigation is content: a department appears in the header, footer and account
 * menu because its row says `show_in_navigation` and it is active, not because
 * a component lists it. Moving a department, renaming it, publishing it or
 * removing it from the navigation is therefore a Control Center action.
 *
 * Failure is safe: a missing table (production before the departments migration
 * is approved) or a network error yields an empty list, and callers fall back to
 * their previous static links instead of rendering a nav with holes in it.
 */
export function useDepartmentsNav(): { departments: Department[]; ready: boolean } {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNavigationDepartments()
      .then((rows) => {
        if (cancelled) return;
        setDepartments(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setDepartments([]);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { departments, ready };
}
