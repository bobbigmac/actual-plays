const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.show.count();
  if (count > 0) return;

  await prisma.show.create({
    data: {
      slug: "example-actualplay",
      title: "Example Actual Play",
      description: "Seeded example show. Replace me with a real RSS feed.",
      rssUrl: "https://feeds.simplecast.com/54nAGcIl",
      siteUrl: "https://example.com",
      tags: ["ttrpg", "actualplay"],
      unapproved: false
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
