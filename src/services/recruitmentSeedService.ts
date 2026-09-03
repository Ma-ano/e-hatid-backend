import { GeographicLocationModel } from "../models/geographicLocation.js";
import { RiderRecruitmentLocationModel } from "../models/riderRecruitmentLocation.js";

const NUEVA_ECIJA = "0304900000";
const NCR = "1300000000";

export async function seedPriorityRecruitmentPages(): Promise<{ createdOrPreserved: number }> {
  const locations = await GeographicLocationModel.find({
    isActive: true,
    $or: [
      { psgcCode: NUEVA_ECIJA },
      { provincePsgcCode: NUEVA_ECIJA, geographicLevel: { $in: ["city", "municipality"] } },
      { psgcCode: NCR },
      { regionPsgcCode: NCR, geographicLevel: { $in: ["city", "municipality"] } },
    ],
  }).lean();
  const locationCodes = locations.map((item) => item.psgcCode);
  const barangayCounts = await GeographicLocationModel.aggregate<{ _id: string; count: number }>([
    { $match: { isActive: true, geographicLevel: "barangay", cityMunicipalityPsgcCode: { $in: locationCodes } } },
    { $group: { _id: "$cityMunicipalityPsgcCode", count: { $sum: 1 } } },
  ]);
  const countByParent = new Map(barangayCounts.map((item) => [item._id, item.count]));

  for (const location of locations) {
    const region = await GeographicLocationModel.findOne({ psgcCode: location.regionPsgcCode }).lean();
    const province = location.provincePsgcCode
      ? await GeographicLocationModel.findOne({ psgcCode: location.provincePsgcCode }).lean()
      : null;
    const typeLabel = location.geographicLevel === "province"
      ? "province"
      : location.geographicLevel === "region"
        ? "region"
        : location.geographicLevel;
    const parentLabel = province?.displayName ?? region?.displayName ?? "Luzon";
    const barangayCount = countByParent.get(location.psgcCode) ?? 0;
    const localInformation = [
      `${location.displayName} is officially classified as a ${typeLabel} in ${parentLabel} under PSGC code ${location.psgcCode}.`,
      barangayCount > 0
        ? `The current PSGC hierarchy contains ${barangayCount.toLocaleString("en-PH")} barangays for this location.`
        : `This page uses the current official PSGC hierarchy for ${location.displayName}.`,
    ];
    const headline = `E-Hatid rider applications in ${location.displayName}`;
    const introduction = `This is E-Hatid's location reference for rider applications in ${location.displayName}. It does not mean recruitment is currently open in this area. Availability is published only after E-Hatid marks the location active.`;
    await RiderRecruitmentLocationModel.updateOne(
      { geographicLocationId: location._id },
      {
        $setOnInsert: {
          geographicLocationId: location._id,
          psgcCode: location.psgcCode,
          slug: location.slug,
          recruitmentStatus: "coming_soon",
          isPublished: true,
          isIndexable: false,
          headline,
          introduction,
          localInformation,
          benefits: [
            "Approved riders can manage delivery work from the existing E-Hatid rider dashboard.",
            "Rider applications and approvals use the same E-Hatid account and notification system.",
          ],
          requirements: [
            "An E-Hatid account with current contact information.",
            "Vehicle type, plate number, and driver's licence details where applicable.",
            "Administrative review and approval before rider dashboard access is enabled.",
          ],
          faqs: [
            {
              question: `Is E-Hatid currently recruiting riders in ${location.displayName}?`,
              answer: `This location is not marked as actively recruiting. E-Hatid will update this page if applications open for ${location.displayName}.`,
            },
            {
              question: "How do I submit a rider application?",
              answer: "Sign in to your E-Hatid account and use the existing Become a rider page. Applications are reviewed by an administrator.",
            },
            {
              question: "What information does the application request?",
              answer: "The current form requests vehicle, plate number, driver's licence, and an optional introduction, together with contact information from your account.",
            },
          ],
          applicationNotes: "Submitting the form does not guarantee approval or confirm that recruitment is open in a specific location.",
          seoTitle: `Rider application information in ${location.displayName} | E-Hatid`.slice(0, 70),
          metaDescription: `Official location reference and E-Hatid rider application information for ${location.displayName}. Check current status before applying.`.slice(0, 170),
          publishedAt: new Date(),
          updatedBy: "psgc-priority-seed",
        },
      },
      { upsert: true },
    );
  }
  return { createdOrPreserved: locations.length };
}
