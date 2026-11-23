import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchVisitorRedirectTarget, markAdminNavigation } from "@/api/visitorSession";
import {
  clearPendingAdminDestination,
  getVisitorRequestId,
  isPendingAdminDestination,
  isRouteAllowed,
  markRouteAllowed,
} from "@/lib/session";
import { isLocalHostPreview } from "@/lib/localPreview";
import { ROUTES } from "@/routes";

export type AdminGatedStatus = "pending" | "allowed" | "denied";

/** يمنع فتح الصفحة مباشرة — يسمح فقط بعد توجيه من لوحة التحكم */
export function useAdminGatedAccess(): AdminGatedStatus {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AdminGatedStatus>(() => {
    if (isLocalHostPreview()) return "allowed";
    if (isRouteAllowed(pathname) || isPendingAdminDestination(pathname)) return "allowed";
    return "pending";
  });

  useEffect(() => {
    if (isLocalHostPreview()) {
      setStatus("allowed");
      return;
    }

    const id = getVisitorRequestId();
    if (!id) {
      setStatus("denied");
      navigate(ROUTES.home, { replace: true });
      return;
    }

    if (isRouteAllowed(pathname) || isPendingAdminDestination(pathname)) {
      markRouteAllowed(pathname);
      setStatus("allowed");
      return;
    }

    let active = true;

    const verify = async () => {
      const dest = await fetchVisitorRedirectTarget();
      if (!active) return;

      if (dest === pathname || isPendingAdminDestination(pathname)) {
        markRouteAllowed(pathname);
        clearPendingAdminDestination();
        setStatus("allowed");
        return;
      }

      // If the admin targeted another specific route, navigate directly there (never bounce to Home)
      if (dest && dest !== pathname && !dest.startsWith("http")) {
        markAdminNavigation(dest);
        markRouteAllowed(dest);
        navigate(dest, { replace: true });
        return;
      }

      // If the visitor has an active registered session, grant access to this step
      markRouteAllowed(pathname);
      setStatus("allowed");
    };

    void verify();

    return () => {
      active = false;
    };
  }, [pathname, navigate]);

  return status;
}