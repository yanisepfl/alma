"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { QUIRKY_MESSAGES } from "@/lib/positions/constants";

export function EmptyState() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage(QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center px-4">
      <div className="flex items-center gap-5">
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0.95 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0"
        >
          <img
            src="/logo.png"
            alt="Alma"
            width={60}
            height={60}
            className="dark:invert"
          />
        </motion.div>
        {message && (
          <motion.p
            animate={{ opacity: 1, x: 0 }}
            initial={{ opacity: 0, x: -8 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="text-4xl text-foreground font-[family-name:var(--font-serif)] leading-tight"
          >
            {message}
          </motion.p>
        )}
      </div>
    </div>
  );
}
