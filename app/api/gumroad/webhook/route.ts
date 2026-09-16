// app/api/gumroad/webhook/route.ts
// Set this as the "Ping" URL in Gumroad → Settings → Advanced. Handles
// sale AND refund/dispute/chargeback pings the same way — Gumroad
// resends a ping with refunded/disputed/chargebacked=true on those
// events, so this one endpoint grants or revokes the plan accordingly.

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyGumroadSale, planIdForGumroadProduct } from "@/lib/gumroad";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const saleId = form.get("sale_id")?.toString();
    if (!saleId) return NextResponse.json({ ok: true });

    const sale = await verifyGumroadSale(saleId);
    if (!sale) return NextResponse.json({ ok: true });

    const uid = sale.custom_fields?.uid || sale.url_params?.uid;
    if (!uid) {
      console.error("[gumroad webhook] sale has no uid attached:", sale.id);
      return NextResponse.json({ ok: true });
    }

    const planId = planIdForGumroadProduct(sale.product_id, sale.product_permalink);
    if (!planId) return NextResponse.json({ ok: true });

    const revoked = sale.refunded || sale.disputed || sale.chargebacked;
    await adminDb().collection("users").doc(uid).collection("settings").doc("plan").set(
      {
        planId: revoked ? "free" : planId,
        gumroadSaleId: sale.id,
        gumroadEmail: sale.email,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/gumroad/webhook]", err);
    return NextResponse.json({ ok: true }); // always 200 — non-200 makes Gumroad retry forever
  }
}