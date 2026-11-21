import { describe, expect, it } from "vitest";
import {
  customerNameOf,
  normalizePhone,
  mapOrder,
  outcomeFor,
  planOutcomeWrite,
  graphqlNodeToPayload,
  type ShopifyOrderLike,
} from "./verafo";

describe("normalizePhone", () => {
  it("collapses every Pakistani form into one canonical number", () => {
    expect(normalizePhone("+92 300 111 2222")).toBe("+923001112222");
    expect(normalizePhone("0301 234 5678")).toBe("+923012345678");
    expect(normalizePhone("00923012345678")).toBe("+923012345678");
    expect(normalizePhone("3012345678")).toBe("+923012345678");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });

  it("keeps international numbers", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
  });
});

describe("mapOrder", () => {
  it("maps a full REST webhook payload", () => {
    const payload: ShopifyOrderLike = {
      id: 123456789,
      name: "#1001",
      created_at: "2026-08-10T12:00:00Z",
      customer: {
        phone: "+92 300 111 2222",
        first_name: "Ayesha",
        last_name: "Siddiqui",
      },
      shipping_address: {
        name: "Ayesha Siddiqui",
        address1: "House 12, Block B",
        city: "Lahore",
        province: "Punjab",
      },
      total_price: "2499.00",
      line_items: [
        { title: "Vitamin C serum", product_type: "Skincare", quantity: 2 },
      ],
    };
    const mapped = mapOrder(payload);
    expect(mapped).toEqual({
      shopifyOrderId: "123456789",
      buyerPhone: "+923001112222",
      customerName: "Ayesha Siddiqui",
      productCategory: "skincare",
      productName: "Vitamin C serum",
      // 2499 total across 2 units → unit price, because the dashboard
      // multiplies price × quantity to get order value.
      price: 1249.5,
      quantity: 2,
      address: "House 12, Block B, Punjab",
      city: "Lahore",
      orderedAt: "2026-08-10T12:00:00Z",
    });
  });

  it("falls back to top-level phone when customer is missing", () => {
    const mapped = mapOrder({ id: "55", phone: "03012345678" } as ShopifyOrderLike);
    expect(mapped).not.toHaveProperty("error");
    if ("buyerPhone" in mapped) expect(mapped.buyerPhone).toBe("+923012345678");
  });

  it("rejects orders with no phone (cannot anchor a buyer)", () => {
    const mapped = mapOrder({ id: "66", name: "#1002" } as ShopifyOrderLike);
    expect(mapped).toMatchObject({ error: expect.stringContaining("phone") });
  });

  it("rejects orders with no id", () => {
    const mapped = mapOrder({ name: "#1003" } as ShopifyOrderLike);
    expect(mapped).toMatchObject({ error: "order has no id" });
  });
});

describe("outcomeFor", () => {
  it("reads cancelled as refused and fulfilled as accepted", () => {
    expect(
      outcomeFor({ id: 1, cancelled_at: "2026-08-01T00:00:00Z", cancel_reason: "customer" }),
    ).toMatchObject({ status: "refused", reason: "customer" });
    expect(outcomeFor({ id: 2, fulfillment_status: "fulfilled" })).toMatchObject({
      status: "accepted",
    });
    expect(outcomeFor({ id: 3 })).toMatchObject({ status: "pending", resolvedAt: null });
  });
});

describe("planOutcomeWrite", () => {
  it("writes when there is no outcome yet", () => {
    expect(planOutcomeWrite(null, "pending")).toBe("insert");
    expect(planOutcomeWrite(undefined, "refused")).toBe("insert");
  });

  it("upgrades a pending outcome once Shopify has a resolution", () => {
    expect(planOutcomeWrite("pending", "refused")).toBe("update");
    expect(planOutcomeWrite("pending", "accepted")).toBe("update");
  });

  it("never overwrites a decision a merchant already made", () => {
    expect(planOutcomeWrite("accepted", "refused")).toBe("skip");
    expect(planOutcomeWrite("refused", "accepted")).toBe("skip");
    expect(planOutcomeWrite("refused", "pending")).toBe("skip");
  });

  it("skips when nothing would change", () => {
    expect(planOutcomeWrite("pending", "pending")).toBe("skip");
    expect(planOutcomeWrite("accepted", "accepted")).toBe("skip");
  });
});

describe("graphqlNodeToPayload", () => {
  it("converts an Admin GraphQL order node to the REST-like shape", () => {
    const node = {
      id: "gid://shopify/Order/987654",
      name: "#2001",
      createdAt: "2026-08-11T09:00:00Z",
      phone: null,
      cancelledAt: null,
      customer: { phone: "+923214445555", firstName: "Bilal", lastName: "Ahmed" },
      shippingAddress: { name: "Bilal Ahmed", address1: "Street 4", city: "Karachi" },
      lineItems: {
        edges: [
          {
            node: {
              title: "Slim jeans",
              quantity: 1,
              product: { productType: "Clothing" },
            },
          },
        ],
      },
      currentTotalPriceSet: { shopMoney: { amount: "2499.00" } },
    };
    const payload = graphqlNodeToPayload(node);
    expect(payload.id).toBe("987654");
    expect(payload.customer?.phone).toBe("+923214445555");
    expect(payload.line_items?.[0]?.product_type).toBe("Clothing");
    expect(payload.total_price).toBe("2499.00");
    expect(payload.created_at).toBe("2026-08-11T09:00:00Z");
    expect(payload.shipping_address?.name).toBe("Bilal Ahmed");
    expect(customerNameOf(payload)).toBe("Bilal Ahmed");
  });
});

describe("customerNameOf", () => {
  it("prefers the shipping-address name, because that is what the courier prints", () => {
    const name = customerNameOf({
      id: "1",
      customer: { first_name: "Account", last_name: "Holder" },
      shipping_address: { name: "  Hina   Raza " },
    } as ShopifyOrderLike);
    expect(name).toBe("Hina Raza");
  });

  it("falls back to the customer's first and last name", () => {
    const name = customerNameOf({
      id: "2",
      customer: { first_name: "Usman", last_name: "Tariq" },
      shipping_address: { name: "   " },
    } as ShopifyOrderLike);
    expect(name).toBe("Usman Tariq");
  });

  it("reads GraphQL casing", () => {
    const name = customerNameOf({
      id: "3",
      customer: { firstName: "Fatima", lastName: "Noor" },
    } as ShopifyOrderLike);
    expect(name).toBe("Fatima Noor");
  });

  it("returns null when Shopify sent no name at all", () => {
    expect(customerNameOf({ id: "4", customer: { phone: "+92300" } } as ShopifyOrderLike)).toBeNull();
    expect(customerNameOf({ id: "5" } as ShopifyOrderLike)).toBeNull();
  });

  it("caps absurdly long names", () => {
    const name = customerNameOf({
      id: "6",
      shipping_address: { name: "x".repeat(400) },
    } as ShopifyOrderLike);
    expect(name?.length).toBe(120);
  });
});
