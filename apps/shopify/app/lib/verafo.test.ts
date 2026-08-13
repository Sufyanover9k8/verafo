import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  mapOrder,
  graphqlNodeToPayload,
  type ShopifyOrderLike,
} from "./verafo";

describe("normalizePhone", () => {
  it("keeps digits and a leading plus", () => {
    expect(normalizePhone("+92 300 111 2222")).toBe("+923001112222");
    expect(normalizePhone("0301 234 5678")).toBe("03012345678");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("mapOrder", () => {
  it("maps a full REST webhook payload", () => {
    const payload: ShopifyOrderLike = {
      id: 123456789,
      name: "#1001",
      created_at: "2026-08-10T12:00:00Z",
      customer: { phone: "+92 300 111 2222" },
      shipping_address: { address1: "House 12, Block B", city: "Lahore", province: "Punjab" },
      total_price: "2499.00",
      line_items: [
        { title: "Vitamin C serum", product_type: "Skincare", quantity: 2 },
      ],
    };
    const mapped = mapOrder(payload);
    expect(mapped).toEqual({
      shopifyOrderId: "123456789",
      buyerPhone: "+923001112222",
      productCategory: "skincare",
      productName: "Vitamin C serum",
      price: 2499,
      quantity: 2,
      address: "House 12, Block B, Punjab",
      city: "Lahore",
      orderedAt: "2026-08-10T12:00:00Z",
    });
  });

  it("falls back to top-level phone when customer is missing", () => {
    const mapped = mapOrder({ id: "55", phone: "03012345678" } as ShopifyOrderLike);
    expect(mapped).not.toHaveProperty("error");
    if ("buyerPhone" in mapped) expect(mapped.buyerPhone).toBe("03012345678");
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

describe("graphqlNodeToPayload", () => {
  it("converts an Admin GraphQL order node to the REST-like shape", () => {
    const node = {
      id: "gid://shopify/Order/987654",
      name: "#2001",
      createdAt: "2026-08-11T09:00:00Z",
      phone: null,
      cancelledAt: null,
      customer: { phone: "+923214445555" },
      shippingAddress: { address1: "Street 4", city: "Karachi" },
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
  });
});
