import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  isNostrixHosted,
  publishHostNavigation,
  subscribeHostNavigation,
} from "./hostSignerBridge";
import { devDiagnostic } from "./devDiagnostics";

/** Makes the outer /groups URL the durable address without remounting Armada. */
export function HostNavigationSync(): null {
  const location = useLocation();
  const navigate = useNavigate();
  const current = useRef(location);
  current.current = location;

  useEffect(() => {
    if (!isNostrixHosted()) return;
    return subscribeHostNavigation((path) => {
      const here = `${current.current.pathname}${current.current.search}${current.current.hash}`;
      devDiagnostic("navigation:host-to-child", { path, here, changed: path !== here });
      if (path !== here) navigate(path, { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (!isNostrixHosted()) return;
    const path = `${location.pathname}${location.search}${location.hash}`;
    devDiagnostic("navigation:child-to-host", { path });
    publishHostNavigation(path);
  }, [location.hash, location.pathname, location.search]);

  return null;
}
