import type { FreqUnit, SiteType } from "@/lib/types";

export type ComplianceTemplate = {
  name: string;
  category: string;
  authority: string;
  frequency_interval: number;
  frequency_unit: FreqUnit;
  lead_days: number;
};

/**
 * Common starting points by site type. Frequencies vary by jurisdiction, cooking volume,
 * landlord and insurer — confirm each with your AHJ before relying on them.
 */
export const TEMPLATES: Record<SiteType, ComplianceTemplate[]> = {
  qsr: [
    { name: "Hood & duct cleaning", category: "Fire/Life Safety", authority: "NFPA 96 / fire dept.", frequency_interval: 3, frequency_unit: "month", lead_days: 14 },
    { name: "Fire suppression system inspection", category: "Fire/Life Safety", authority: "NFPA 17A", frequency_interval: 6, frequency_unit: "month", lead_days: 21 },
    { name: "Fire extinguisher service", category: "Fire/Life Safety", authority: "NFPA 10", frequency_interval: 1, frequency_unit: "year", lead_days: 21 },
    { name: "Grease interceptor pumping", category: "Plumbing", authority: "City FOG program", frequency_interval: 3, frequency_unit: "month", lead_days: 10 },
    { name: "Backflow preventer test", category: "Plumbing", authority: "Water district", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Pest control service", category: "Pest Control", authority: "Health dept.", frequency_interval: 1, frequency_unit: "month", lead_days: 5 },
    { name: "Health permit renewal", category: "Permits", authority: "County health dept.", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Emergency / exit lighting test", category: "Fire/Life Safety", authority: "NFPA 101", frequency_interval: 1, frequency_unit: "year", lead_days: 21 },
  ],
  dine_in: [
    { name: "Hood & duct cleaning", category: "Fire/Life Safety", authority: "NFPA 96 / fire dept.", frequency_interval: 3, frequency_unit: "month", lead_days: 14 },
    { name: "Fire suppression system inspection", category: "Fire/Life Safety", authority: "NFPA 17A", frequency_interval: 6, frequency_unit: "month", lead_days: 21 },
    { name: "Fire extinguisher service", category: "Fire/Life Safety", authority: "NFPA 10", frequency_interval: 1, frequency_unit: "year", lead_days: 21 },
    { name: "Fire sprinkler inspection", category: "Fire/Life Safety", authority: "NFPA 25", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Fire alarm inspection", category: "Fire/Life Safety", authority: "NFPA 72", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Grease interceptor pumping", category: "Plumbing", authority: "City FOG program", frequency_interval: 3, frequency_unit: "month", lead_days: 10 },
    { name: "Backflow preventer test", category: "Plumbing", authority: "Water district", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Pest control service", category: "Pest Control", authority: "Health district", frequency_interval: 1, frequency_unit: "month", lead_days: 5 },
    { name: "Health permit renewal", category: "Permits", authority: "Health district", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Liquor license renewal", category: "Permits", authority: "State / local licensing", frequency_interval: 1, frequency_unit: "year", lead_days: 45 },
  ],
  cre: [
    { name: "Fire alarm inspection", category: "Fire/Life Safety", authority: "NFPA 72", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Fire sprinkler inspection", category: "Fire/Life Safety", authority: "NFPA 25", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Fire extinguisher service", category: "Fire/Life Safety", authority: "NFPA 10", frequency_interval: 1, frequency_unit: "year", lead_days: 21 },
    { name: "Elevator inspection / certificate", category: "Building", authority: "State elevator authority", frequency_interval: 1, frequency_unit: "year", lead_days: 45 },
    { name: "Backflow preventer test", category: "Plumbing", authority: "Water district", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Roof inspection", category: "Building", authority: "Landlord / insurer", frequency_interval: 6, frequency_unit: "month", lead_days: 21 },
    { name: "Parking lot / ADA path inspection", category: "Grounds/Parking", authority: "ADA / insurer", frequency_interval: 1, frequency_unit: "year", lead_days: 30 },
    { name: "Emergency / exit lighting test", category: "Fire/Life Safety", authority: "NFPA 101", frequency_interval: 1, frequency_unit: "year", lead_days: 21 },
  ],
};
