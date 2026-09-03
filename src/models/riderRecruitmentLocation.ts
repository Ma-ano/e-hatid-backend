import { Schema, model, type InferSchemaType } from "mongoose";

const faqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 240 },
    answer: { type: String, required: true, trim: true, maxlength: 1200 },
  },
  { _id: false },
);

const salarySchema = new Schema(
  {
    currency: { type: String, enum: ["PHP"], required: true },
    unitText: { type: String, enum: ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"], required: true },
    minValue: { type: Number, required: true, min: 0 },
    maxValue: { type: Number, required: true, min: 0 },
    verifiedAt: { type: Date, required: true },
    sourceNote: { type: String, required: true, maxlength: 500 },
  },
  { _id: false },
);

const riderRecruitmentLocationSchema = new Schema(
  {
    geographicLocationId: { type: Schema.Types.ObjectId, ref: "GeographicLocation", required: true, unique: true },
    psgcCode: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    recruitmentStatus: {
      type: String,
      enum: ["inactive", "coming_soon", "active", "paused", "closed"],
      required: true,
      default: "inactive",
    },
    isPublished: { type: Boolean, required: true, default: false },
    isIndexable: { type: Boolean, required: true, default: false },
    headline: { type: String, required: true, trim: true, maxlength: 180 },
    introduction: { type: String, required: true, trim: true, maxlength: 2000 },
    localInformation: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    faqs: { type: [faqSchema], default: [] },
    applicationNotes: { type: String, default: "", maxlength: 1200 },
    seoTitle: { type: String, required: true, trim: true, maxlength: 70 },
    metaDescription: { type: String, required: true, trim: true, maxlength: 170 },
    salary: { type: salarySchema, default: undefined },
    validThrough: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true, versionKey: false },
);

riderRecruitmentLocationSchema.pre("validate", function validateIndexability() {
  if (this.isIndexable && (!this.isPublished || this.recruitmentStatus !== "active")) {
    this.invalidate("isIndexable", "Only active, published recruitment pages may be indexable");
  }
  if (this.salary && this.salary.maxValue < this.salary.minValue) {
    this.invalidate("salary.maxValue", "Salary maximum must be greater than or equal to minimum");
  }
});

riderRecruitmentLocationSchema.index({ isPublished: 1, isIndexable: 1, recruitmentStatus: 1, updatedAt: -1 });

export type RiderRecruitmentLocation = InferSchemaType<typeof riderRecruitmentLocationSchema>;
export const RiderRecruitmentLocationModel = model("RiderRecruitmentLocation", riderRecruitmentLocationSchema);
