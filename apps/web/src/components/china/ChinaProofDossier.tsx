"use client";

import React, { useState } from "react";
import {
  type ChineseEquityAsset,
  type ChineseEquityProof,
} from "../../lib/chinese-equities-client";

export function ChinaProofDossier({
  asset,
  proof,
}: {
  asset: ChineseEquityAsset;
  proof?: ChineseEquityProof;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string | null | undefined, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!proof) {
    return (
      <div className="bg-[#0c0d0c] border border-[#1f201d] p-8 text-center rounded-sm font-sans">
        <h3 className="text-sm font-bold font-display text-[#f4f4f0]">
          Dossier Verification Pending
        </h3>
        <p className="text-xs text-[#9b9b99] mt-2 max-w-md mx-auto leading-relaxed">
          The legal and technical acceptance dossier for {asset.name} is currently in
          the research queue. No markets are active on Robinhood Chain until verified.
        </p>
      </div>
    );
  }

  const isNative = asset.verificationStatus === "VERIFIED_NATIVE_IDENTITY";
  const isExternal = asset.verificationStatus === "VERIFIED_EXTERNAL_PRODUCT";
  const isResearch = asset.verificationStatus === "RESEARCH_ONLY";

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* HEADER BANNER */}
      <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col md:flex-row md:items-center justify-between gap-4 whitespace-nowrap">
        <div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {isNative && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-[#c2ff47] shadow-[0_0_8px_rgba(194,255,71,0.6)] shrink-0" />
                <span className="text-xs uppercase font-display font-bold text-[#c2ff47] tracking-wider whitespace-nowrap">
                  Verified Native Asset · Robinhood Chain 4663
                </span>
              </>
            )}
            {isExternal && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-[#f5a623] shrink-0" />
                <span className="text-xs uppercase font-display font-bold text-[#f5a623] tracking-wider whitespace-nowrap">
                  External Tokenized Asset · {proof.tokenIssuer}
                </span>
              </>
            )}
            {isResearch && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-[#777] shrink-0" />
                <span className="text-xs uppercase font-display font-bold text-[#999] tracking-wider whitespace-nowrap">
                  Research Pipeline Candidate
                </span>
              </>
            )}
          </div>
          <h2 className="text-lg font-bold font-display text-[#f4f4f0] mt-1.5 whitespace-nowrap">
            {asset.company} ({asset.ticker}) · Acceptance Dossier
          </h2>
          <span className="text-xs text-[#9b9b99] block mt-0.5 whitespace-nowrap">
            Verified by {proof.verifiedBy} · Last reviewed{" "}
            {new Date(proof.lastVerificationDate).toLocaleDateString()}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          {proof.documentationUrl && (
            <a
              href={proof.documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#181a16] hover:bg-[#c2ff47] text-[#c8cbc0] hover:text-[#080808] border border-[#2f332a] hover:border-[#c2ff47] font-display font-medium text-xs transition-all shrink-0 whitespace-nowrap"
            >
              <span>Issuer Documentation</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* ARCHITECTURAL SPECIFICATION */}
      <div
        className={`p-4 rounded-sm border text-xs leading-relaxed ${
          isNative
            ? "bg-[#10140d] border-[#293d18] text-[#c8d4be]"
            : isExternal
            ? "bg-[#17140e] border-[#3f3116] text-[#dfcfb0]"
            : "bg-[#121212] border-[#222] text-[#999]"
        }`}
      >
        {isNative && (
          <p>
            <strong className="text-[#c2ff47]">Robinhood Chain Native Identity:</strong>{" "}
            This asset is issued and deployed natively on Robinhood Chain (Chain ID 4663).
            Collateral deposits, USDG borrows, and leveraged long positions settle directly via
            native isolated credit markets on Robinhood Chain.
          </p>
        )}
        {isExternal && (
          <p>
            <strong className="text-[#f5a623]">External Product Architecture:</strong>{" "}
            This instrument is issued by {proof.tokenIssuer} on primary EVM venues.
            Underlying collateral is held in institutional trust. Secondary execution routes
            and custody bridges enable verified economic exposure on Robinhood Chain.
          </p>
        )}
        {isResearch && (
          <p>
            <strong className="text-[#bbb]">Research Pipeline:</strong>{" "}
            Monitored for market liquidity and custodial availability. No live tokenized deployment
            is currently active for this underlying equity.
          </p>
        )}
      </div>

      {/* 4 CORE DOSSIER SECTIONS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Issuer Legal Entity & Jurisdiction */}
        <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col justify-between gap-4">
          <div>
            <span className="text-[10px] text-[#777] uppercase font-display tracking-wider block whitespace-nowrap">
              01 / Legal Issuer &amp; Registration
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0] mt-1 whitespace-nowrap">
              {proof.tokenIssuer}
            </h3>
            <span className="text-xs text-[#c2ff47] font-mono block mt-0.5 whitespace-nowrap">
              {proof.issuerEntityRegistration}
            </span>
            <p className="text-xs text-[#9b9b99] mt-3 leading-relaxed">
              <strong>Structure:</strong> {proof.issuerLegalStructure}.
            </p>
          </div>
          <div className="p-3 bg-[#080808] border border-[#181917] rounded text-[11px] text-[#9b9b99]">
            {isNative
              ? "Governed by Jersey law. Bankruptcy-remote SPV designed to insulate tokenholders from operational liabilities."
              : isExternal
              ? "Regulated external debt/tracker vehicle under approved prospectus framework."
              : "Pending issuer legal vehicle filings."}
          </div>
        </div>

        {/* Card 2: Tokenholder Entitlement */}
        <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col justify-between gap-4">
          <div>
            <span className="text-[10px] text-[#777] uppercase font-display tracking-wider block whitespace-nowrap">
              02 / Tokenholder Entitlement &amp; Rights
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0] mt-1 whitespace-nowrap">
              Contractual Economic Exposure
            </h3>
            <p className="text-xs text-[#9b9b99] mt-2 leading-relaxed">
              {proof.tokenholderEntitlement}
            </p>
          </div>
          <div className="p-3 bg-[#080808] border border-[#181917] rounded text-[11px] text-[#f5a623]">
            Investor Notice: Tracks economic performance. Does not convey direct company voting rights or direct legal ownership of mainland operating subsidiaries.
          </div>
        </div>

        {/* Card 3: Custody & Reserve Backing */}
        <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col justify-between gap-4">
          <div>
            <span className="text-[10px] text-[#777] uppercase font-display tracking-wider block whitespace-nowrap">
              03 / Custody &amp; Collateral Segregation
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0] mt-1 whitespace-nowrap">
              Segregated Institutional Custody
            </h3>
            <p className="text-xs text-[#9b9b99] mt-2 leading-relaxed">
              {proof.custodyAndBacking}
            </p>
          </div>
          <div className="p-3 bg-[#080808] border border-[#181917] rounded text-[11px] text-[#9b9b99]">
            Depositary Framework: {asset.depositaryStructure || "Qualified Institutional Custodian"}.
          </div>
        </div>

        {/* Card 4: Corporate Actions & Multipliers */}
        <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col justify-between gap-4">
          <div>
            <span className="text-[10px] text-[#777] uppercase font-display tracking-wider block whitespace-nowrap">
              04 / Corporate Action Accounting
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0] mt-1 whitespace-nowrap">
              Total Return Multiplier Scaling
            </h3>
            <p className="text-xs text-[#9b9b99] mt-2 leading-relaxed">
              {proof.corporateActionPolicy}
            </p>
          </div>
          <div className="p-3 bg-[#080808] border border-[#181917] rounded text-[11px] text-[#9b9b99]">
            Balances remain stable in token units. Oracle scales economic valuation without rebase friction.
          </div>
        </div>
      </div>

      {/* SMART CONTRACT & ORACLE DETAILS */}
      <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm">
        <h3 className="text-sm font-bold font-display text-[#f4f4f0] mb-4 whitespace-nowrap">
          On-Chain Technical Identifiers &amp; Infrastructure
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {/* Token Contract */}
          <div className="bg-[#080808] border border-[#181917] p-3.5 rounded flex flex-col justify-between gap-2">
            <div>
              <span className="text-[10px] text-[#777] uppercase font-display block whitespace-nowrap">
                Token Contract Deployment (Chain ID 4663)
              </span>
              {proof.contractAddress ? (
                <span className="text-[#c2ff47] break-all block mt-1">
                  {proof.contractAddress}
                </span>
              ) : (
                <span className="text-[#999] block mt-1 font-sans text-[11px]">
                  {isExternal
                    ? "External Issuer Product (Primary Network Deployment)"
                    : "Unassigned (Research Pipeline)"}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[#181917] whitespace-nowrap">
              {proof.contractAddress ? (
                <>
                  <a
                    href={`https://robinhoodchain.blockscout.com/address/${proof.contractAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[#9b9b99] hover:text-white font-sans inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>View on Blockscout</span>
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <button
                    onClick={() => handleCopy(proof.contractAddress, "token")}
                    className="text-[11px] px-2 py-0.5 rounded bg-[#161715] text-[#ccc] hover:text-white border border-[#292a27] whitespace-nowrap"
                  >
                    {copiedKey === "token" ? "Copied" : "Copy"}
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-[#666] font-sans whitespace-nowrap">
                  External custody reference
                </span>
              )}
            </div>
          </div>

          {/* Chainlink Oracle Feed */}
          <div className="bg-[#080808] border border-[#181917] p-3.5 rounded flex flex-col justify-between gap-2">
            <div>
              <span className="text-[10px] text-[#777] uppercase font-display block whitespace-nowrap">
                Chainlink Total Return Reference Feed
              </span>
              {proof.chainlinkFeedAddress ? (
                <span className="text-[#c2ff47] break-all block mt-1">
                  {proof.chainlinkFeedAddress}
                </span>
              ) : (
                <span className="text-[#999] block mt-1 font-sans text-[11px] whitespace-nowrap">
                  {proof.oracleMethodology}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[#181917] whitespace-nowrap">
              <span className="text-[10px] text-[#888] font-sans whitespace-nowrap">
                {proof.chainlinkFeedAddress ? "Heartbeat: 86,400s (Daily)" : "Active consolidated pricing"}
              </span>
              {proof.chainlinkFeedAddress && (
                <button
                  onClick={() => handleCopy(proof.chainlinkFeedAddress, "oracle")}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#161715] text-[#ccc] hover:text-white border border-[#292a27] whitespace-nowrap"
                >
                  {copiedKey === "oracle" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>

          {/* Bytecode SHA-256 */}
          <div className="bg-[#080808] border border-[#181917] p-3.5 rounded flex flex-col justify-between gap-2">
            <div>
              <span className="text-[10px] text-[#777] uppercase font-display block whitespace-nowrap">
                Verified Contract Bytecode SHA-256
              </span>
              {proof.contractBytecodeSha256 ? (
                <span className="text-[#d1d4cb] break-all block mt-1">
                  {proof.contractBytecodeSha256}
                </span>
              ) : (
                <span className="text-[#888] block mt-1 font-sans text-[11px]">
                  Verified on-chain via Robinhood Chain verified source registry.
                </span>
              )}
            </div>
            <div className="flex items-center justify-end pt-2 border-t border-[#181917] whitespace-nowrap">
              {proof.contractBytecodeSha256 && (
                <button
                  onClick={() => handleCopy(proof.contractBytecodeSha256, "bytecode")}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#161715] text-[#ccc] hover:text-white border border-[#292a27] whitespace-nowrap"
                >
                  {copiedKey === "bytecode" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>

          {/* Governance Evidence Hash */}
          <div className="bg-[#080808] border border-[#181917] p-3.5 rounded flex flex-col justify-between gap-2">
            <div>
              <span className="text-[10px] text-[#777] uppercase font-display block whitespace-nowrap">
                Levier Governance Market Identifier
              </span>
              {proof.governanceEvidenceHash ? (
                <span className="text-[#d1d4cb] break-all block mt-1">
                  {proof.governanceEvidenceHash}
                </span>
              ) : (
                <span className="text-[#888] block mt-1 font-sans text-[11px]">
                  Configured under Levier Isolated Risk Committee Registry.
                </span>
              )}
            </div>
            <div className="flex items-center justify-end pt-2 border-t border-[#181917] whitespace-nowrap">
              {proof.governanceEvidenceHash && (
                <button
                  onClick={() => handleCopy(proof.governanceEvidenceHash, "gov")}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#161715] text-[#ccc] hover:text-white border border-[#292a27] whitespace-nowrap"
                >
                  {copiedKey === "gov" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
