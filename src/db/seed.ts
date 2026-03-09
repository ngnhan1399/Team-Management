import crypto from "crypto";
import { db, ensureDatabaseInitialized } from "./index";
import { royaltyRates, collaborators, users } from "./schema";
import { hashPassword } from "@/lib/auth";

const ROYALTY_DATA = [
    { articleType: "Mô tả SP ngắn", contentType: "Viết mới" as const, price: 80000 },
    { articleType: "Mô tả SP ngắn", contentType: "Viết lại" as const, price: 40000 },
    { articleType: "Mô tả SP dài", contentType: "Viết mới" as const, price: 120000 },
    { articleType: "Mô tả SP dài", contentType: "Viết lại" as const, price: 60000 },
    { articleType: "Bài dịch Review SP", contentType: "Viết lại" as const, price: 80000 },
    { articleType: "Bài SEO ICT", contentType: "Viết mới" as const, price: 100000 },
    { articleType: "Bài SEO ICT", contentType: "Viết lại" as const, price: 50000 },
    { articleType: "Bài SEO Gia dụng", contentType: "Viết mới" as const, price: 100000 },
    { articleType: "Bài SEO Gia dụng", contentType: "Viết lại" as const, price: 50000 },
    { articleType: "Bài SEO ICT 1K5", contentType: "Viết mới" as const, price: 160000 },
    { articleType: "Bài SEO ICT 1K5", contentType: "Viết lại" as const, price: 80000 },
    { articleType: "Bài SEO Gia dụng 1K5", contentType: "Viết mới" as const, price: 140000 },
    { articleType: "Bài SEO Gia dụng 1K5", contentType: "Viết lại" as const, price: 70000 },
    { articleType: "Bài SEO ICT 2K", contentType: "Viết mới" as const, price: 200000 },
    { articleType: "Bài SEO ICT 2K", contentType: "Viết lại" as const, price: 100000 },
    { articleType: "Bài SEO Gia dụng 2K", contentType: "Viết mới" as const, price: 180000 },
    { articleType: "Bài SEO Gia dụng 2K", contentType: "Viết lại" as const, price: 90000 },
    { articleType: "Thủ thuật", contentType: "Viết mới" as const, price: 120000 },
];

const CTV_DATA = [
    { name: "CTV Demo 01", penName: "Bút Danh 01", role: "writer" as const, kpiStandard: 25, email: "writer01@demo.local", phone: "0900000001", bankName: "Demo Bank" },
    { name: "CTV Demo 02", penName: "Bút Danh 02", role: "writer" as const, kpiStandard: 25, email: "writer02@demo.local", phone: "0900000002", bankName: "Demo Bank" },
    { name: "CTV Demo 03", penName: "Bút Danh 03", role: "writer" as const, kpiStandard: 25, email: "writer03@demo.local", phone: "0900000003", bankName: "Demo Bank" },
    { name: "CTV Demo 04", penName: "Bút Danh 04", role: "writer" as const, kpiStandard: 25, email: "writer04@demo.local", phone: "0900000004", bankName: "Demo Bank" },
    { name: "CTV Demo 05", penName: "Bút Danh 05", role: "writer" as const, kpiStandard: 25, email: "writer05@demo.local", phone: "0900000005", bankName: "Demo Bank" },
    { name: "CTV Demo 06", penName: "Bút Danh 06", role: "writer" as const, kpiStandard: 25, email: "writer06@demo.local", phone: "0900000006", bankName: "Demo Bank" },
    { name: "CTV Demo 07", penName: "Bút Danh 07", role: "writer" as const, kpiStandard: 25, email: "writer07@demo.local", phone: "0900000007", bankName: "Demo Bank" },
    { name: "CTV Demo 08", penName: "Bút Danh 08", role: "writer" as const, kpiStandard: 25, email: "writer08@demo.local", phone: "0900000008", bankName: "Demo Bank" },
    { name: "Admin Demo", penName: "Quản trị Demo", role: "editor" as const, kpiStandard: 100, email: "admin@demo.local", phone: "" },
];

export async function seedDatabase() {
    await ensureDatabaseInitialized();

    const existingRates = await db.select().from(royaltyRates).all();
    if (existingRates.length === 0) {
        for (const rate of ROYALTY_DATA) {
            await db.insert(royaltyRates).values(rate).run();
        }
        console.log(`✅ Seeded ${ROYALTY_DATA.length} royalty rates`);
    }

    const existingCTVs = await db.select().from(collaborators).all();
    if (existingCTVs.length === 0) {
        for (const ctv of CTV_DATA) {
            await db.insert(collaborators).values(ctv).run();
        }
        console.log(`✅ Seeded ${CTV_DATA.length} demo collaborators`);
    }

    const existingUsers = await db.select().from(users).all();
    if (existingUsers.length === 0) {
        const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || "admin@demo.local";
        const adminPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
        const adminPasswordHash = await hashPassword(adminPassword);
        await db.insert(users).values({
            email: adminEmail,
            passwordHash: adminPasswordHash,
            role: "admin",
            collaboratorId: 9,
            mustChangePassword: true,
        }).run();
        console.log(`✅ Seeded admin user: ${adminEmail}`);
        console.log(`⚠️ Temporary admin password: ${adminPassword}`);
        console.log("⚠️ First login will require a password change.");
    }
}
