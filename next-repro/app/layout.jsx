import "./demo.css";

export const metadata = {
    title: "Next keyboard reveal repro",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
