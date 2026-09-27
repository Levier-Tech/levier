import { redirect } from "next/navigation";
import { marketPath } from "../../../lib/asset-catalog";
export default function LegacyMarketPage({
  params,
}: {
  params: { asset: string };
}) {
  redirect(marketPath(params.asset));
}
