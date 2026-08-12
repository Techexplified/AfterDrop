import {PrismaClient} from "@prisma/client";
import {randomUUID} from "crypto";

const db = new PrismaClient();

async function backfill() {
    console.log("checking for orders missing review token...");

    const ordersWithoutTokens = await db.order.findMany({
        where: {reviewToken: null},
    })

    if(ordersWithoutTokens.length === 0){
        console.log("All orders have tokens");
        return;
    }

    console.log(`Found ${ordersWithoutTokens.length} orders. Assigning Tokens...`);

    let count = 0;
    for(const order of ordersWithoutTokens){
        await db.order.update({
            where: {id: order.id},
            data: {reviewToken: randomUUID()},
        })
        count++;
    }

    console.log(`Succesfully backfilled ${count} orders with reveiw tokens`);
}

backfill()
    .catch((err) => {
        console.error("Backfill failed:", err);
    })
    .finally( async () => {
        await db.$disconnect();
    })