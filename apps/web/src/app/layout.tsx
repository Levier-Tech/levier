"use client";

import React from "react";
import "./globals.css";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { Web3Provider } from "../providers/Web3Provider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>LEVIER MARKETS | Credit & Leverage for Tokenized Assets</title>
        <meta
          name="description"
          content="The credit and leverage layer for tokenized assets on Robinhood Chain. Explore the Levier Markets interface."
        />
        <meta name="theme-color" content="#080808" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&display=swap"
        />
      </head>
      <body className="bg-[#080808] text-[#f4f4f0] min-h-screen flex flex-col font-sans selection:bg-[#c2ff47] selection:text-[#080808] antialiased">
        <Web3Provider>
          <Header />
          <main id="main" className="flex-1 w-full mx-auto pt-[79px] min-[901px]:pt-[86px] min-[1051px]:pt-[100px]">
            {children}
          </main>
          <Footer />
        </Web3Provider>
      </body>
    </html>
  );
}
