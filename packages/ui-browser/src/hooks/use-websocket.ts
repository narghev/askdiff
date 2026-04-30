import { useEffect } from "react";
import { connect, disconnect } from "@/lib/ws";

export const useWebSocket = () => {
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);
};
