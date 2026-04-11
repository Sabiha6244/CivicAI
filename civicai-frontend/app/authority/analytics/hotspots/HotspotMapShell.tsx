"use client";

import dynamic from "next/dynamic";
import styles from "../../authority.module.css";

const HotspotMapClient = dynamic(() => import("./HotspotMapClient"), {
  ssr: false,
  loading: () => <div className={styles.emptyBox}>Loading hotspot map...</div>,
});

export default function HotspotMapShell({ points }: { points: any[] }) {
  return <HotspotMapClient points={points} />;
}
