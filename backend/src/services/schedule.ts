import { prisma } from '../db';

export async function findEmployeesByName(name: string): Promise<{ employeeNik: string; name: string; jobTitle: string }[]> {
  // Search by partial name match (case-insensitive)
  const results = await prisma.schedule.findMany({
    where: { name: { contains: name } },
    select: { employeeNik: true, name: true, jobTitle: true },
    distinct: ['employeeNik'],
  });
  return results;
}

export async function findEmployeeByNik(nik: string): Promise<{ employeeNik: string; name: string; jobTitle: string } | null> {
  const result = await prisma.schedule.findFirst({
    where: { employeeNik: nik },
    select: { employeeNik: true, name: true, jobTitle: true },
  });
  return result;
}

export async function pairUserSchedule(telegramId: bigint, employeeNik: string): Promise<void> {
  await prisma.userSchedule.upsert({
    where: { telegramId },
    update: { employeeNik },
    create: { telegramId, employeeNik },
  });
}

export async function getUserPairing(telegramId: bigint) {
  return prisma.userSchedule.findUnique({ where: { telegramId } });
}

export function extractNameFromEmail(email: string): string {
  // email format: firstname.lastname@domain.com or firstname@domain.com
  const local = email.split('@')[0];
  // Replace dots/underscores with spaces, capitalize
  return local
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
