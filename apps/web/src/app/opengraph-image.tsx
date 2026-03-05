import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)",
          color: "white",
          padding: "56px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            opacity: 0.95,
          }}
        >
          Link Monitor by Adler
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              fontSize: 74,
              lineHeight: 1.02,
              fontWeight: 800,
              maxWidth: "960px",
            }}
          >
            Monitor backlinks. Protect SEO revenue.
          </div>
          <div style={{ fontSize: 30, opacity: 0.9 }}>
            Alerts · KPI · Reporting · Team-ready operations
          </div>
        </div>

        <div style={{ fontSize: 26, opacity: 0.85 }}>linkmonitor.app</div>
      </div>
    ),
    {
      ...size,
    }
  );
}
