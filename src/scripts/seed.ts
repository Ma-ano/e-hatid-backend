import bcrypt from "bcryptjs";
import { connectToDatabase, disconnectFromDatabase } from "../config/db.js";
import { UserModel } from "../models/user.js";
import { StallModel } from "../models/stall.js";
import { OrderModel } from "../models/order.js";
import { ReviewModel } from "../models/review.js";
import { NotificationModel } from "../models/notification.js";
import { ApplicationModel } from "../models/application.js";
import { OtpRequestModel } from "../models/otpRequest.js";
import { RiderLocationModel } from "../models/riderLocation.js";
import { RiderModel } from "../models/rider.js";
import { RiderReviewModel } from "../models/riderReview.js";
import { ConfigModel } from "../models/config.js";
import { env } from "../config/env.js";

const PASSWORD = "password123";
const BCRYPT_ROUNDS = 12;

async function upsertUser(input: {
  email: string;
  name: string;
  roles: string[];
  roleStatus: Record<string, string>;
  isMasterAdmin?: boolean;
  phone?: string;
  vehicle?: string;
  licensePlate?: string;
  stallName?: string;
}): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const activeRole = input.roles.includes("customer") ? "customer" : input.roles[0];
  await UserModel.findOneAndUpdate(
    { email: input.email },
    {
      $set: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? "",
        passwordHash,
        emailVerified: true,
        roles: input.roles,
        role: activeRole,
        activeRole,
        roleStatus: input.roleStatus,
        isMasterAdmin: input.isMasterAdmin ?? false,
        vehicle: input.vehicle ?? "",
        licensePlate: input.licensePlate ?? "",
        stallName: input.stallName ?? "",
      },
    },
    { upsert: true, new: true },
  );
}

/** Deterministic unique id generator so item/option/add-on ids never collide. */
function makeIdFactory(): () => number {
  let n = 0;
  return () => ++n;
}

const STALLS: Array<{
  name: string;
  description: string;
  vendorEmail: string;
  category: string;
  cuisine: string;
  deliveryTime: string;
  deliveryFee: number;
  minOrder: number;
  accentColor: string;
  image: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  isNew?: boolean;
  menu: Array<{
    name: string;
    description: string;
    price: number;
    category: string;
    image: string;
    popular?: boolean;
    options?: Array<{ name: string; required: boolean; maxSelections: number; choices: Array<{ name: string; price: number }> }>;
    addOns?: Array<{ name: string; price: number }>;
  }>;
}> = [
  {
    name: "Ate Maria's Tapsilogan",
    description: "Home-style silog breakfasts and tapsilog classics, served hot all day.",
    vendorEmail: "vendor@ehatid.com",
    category: "Breakfast",
    cuisine: "Filipino",
    deliveryTime: "25 - 35",
    deliveryFee: 40,
    minOrder: 100,
    accentColor: "#B45309",
    image: "https://images.unsplash.com/photo-1551218808-94e220e084d2",
    address: "Block 12, P. Burgos St, Brgy. San Lorenzo, Makati",
    latitude: 14.5561,
    longitude: 121.0232,
    rating: 4.6,
    menu: [
      { name: "Garlic Tapsilog", description: "Beef tapa, garlic rice and fried egg", price: 99, category: "Silog", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19", popular: true, addOns: [{ name: "Extra rice", price: 15 }, { name: "Extra fried egg", price: 20 }] },
      { name: "Longganisa Silog", description: "Sweet garlic longganisa with rice and egg", price: 105, category: "Silog", image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4", addOns: [{ name: "Extra rice", price: 15 }, { name: "Salted egg", price: 15 }] },
      { name: "Tocilog", description: "Crispy pork tocino, garlic rice and egg", price: 95, category: "Silog", image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836", popular: true },
      { name: "Bangus Silog", description: "Grilled milkfish with rice and egg", price: 115, category: "Silog", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c" },
      { name: "Iced Coffee", description: "Strong brewed coffee over ice", price: 40, category: "Drinks", image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93" },
    ],
  },
  {
    name: "Lola Cely's Halo-Halo",
    description: "Family-made halo-halo, ice scrambles and cold Filipino desserts since 1998.",
    vendorEmail: "vendor@ehatid.com",
    category: "Desserts",
    cuisine: "Halo-Halo",
    deliveryTime: "15 - 25",
    deliveryFee: 30,
    minOrder: 80,
    accentColor: "#DB2777",
    image: "https://images.unsplash.com/photo-1563805042-7684c019e1cb",
    address: "96 Senator Gil Puyat Ave, Brgy. Bel-Air, Makati",
    latitude: 14.5566,
    longitude: 121.022,
    rating: 4.4,
    menu: [
      { name: "Classic Halo-Halo", description: "Shaved ice, ube ice cream, leche flan and assorted preserves", price: 65, category: "Desserts", image: "https://images.unsplash.com/photo-1563805042-7684c019e1cb", popular: true, options: [{ name: "Size", required: true, maxSelections: 1, choices: [{ name: "Regular", price: 0 }, { name: "Large", price: 20 }] }] },
      { name: "Mais Con Yelo", description: "Sweet corn, condensed milk and shaved ice", price: 55, category: "Desserts", image: "https://images.unsplash.com/photo-1565958011703-44f9829ba187" },
      { name: "Leche Flan", description: "Caramel custard slice", price: 45, category: "Desserts", image: "https://images.unsplash.com/photo-1551024506-0bccd828d307", popular: true },
      { name: "Sago't Gulaman", description: "Sweet sago and gulaman drink over ice", price: 35, category: "Drinks", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699" },
      { name: "Ube Ice Cream", description: "Two scoops of creamy purple yam ice cream", price: 50, category: "Desserts", image: "https://images.unsplash.com/photo-1563805042-7684c019e1cb" },
    ],
  },
  {
    name: "Kuya Ben's BBQ",
    description: "Sweet and smoky ihaw-ihaw grilled on the spot — the neighborhood favorite.",
    vendorEmail: "vendor2@ehatid.com",
    category: "Ihaw-Ihaw",
    cuisine: "Grilled",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 80,
    accentColor: "#DC2626",
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1",
    address: "120 Banawe St, Quezon City",
    latitude: 14.6269,
    longitude: 121.0174,
    rating: 4.8,
    menu: [
      { name: "Pork BBQ Sticks", description: "Sweet glazed grilled pork skewers (2 pcs)", price: 45, category: "Ihaw-Ihaw", image: "https://images.unsplash.com/photo-1558030006-450675393462", popular: true, addOns: [{ name: "Extra stick", price: 45 }] },
      { name: "Chicken Inasal", description: "Annatto-marinated grilled chicken with sinamak", price: 120, category: "Ihaw-Ihaw", image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1", popular: true, options: [{ name: "Spice level", required: false, maxSelections: 1, choices: [{ name: "Mild", price: 0 }, { name: "Spicy", price: 0 }, { name: "Very spicy", price: 0 }] }], addOns: [{ name: "Java rice", price: 20 }] },
      { name: "Isaw", description: "Grilled chicken intestines (4 sticks)", price: 15, category: "Street Food", image: "https://images.unsplash.com/photo-1558030006-450675393462" },
      { name: "Betamax", description: "Grilled coagulated chicken blood cubes", price: 20, category: "Street Food", image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1" },
      { name: "Puso (Hanging Rice)", description: "Woven palm-wrapped steamed rice", price: 10, category: "Rice", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
    ],
  },
  {
    name: "Barkada Sisig",
    description: "Sizzling sisig and sizzling plates made for sharing with the barkada.",
    vendorEmail: "vendor2@ehatid.com",
    category: "Sizzling",
    cuisine: "Sizzling",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 80,
    accentColor: "#7C3AED",
    image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe",
    address: "3rd Floor, Kultura Mall, Katipunan Ave, Quezon City",
    latitude: 14.6519,
    longitude: 121.0641,
    rating: 4.5,
    menu: [
      { name: "Classic Pork Sisig", description: "Chopped pig face, onions and chili on a sizzling plate with egg", price: 99, category: "Sizzling", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe", popular: true, addOns: [{ name: "Extra rice", price: 15 }, { name: "Extra egg", price: 20 }] },
      { name: "Sisig Rice Bowl", description: "Pork sisig over garlic rice", price: 119, category: "Rice Meals", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19", popular: true },
      { name: "Chicken Sisig", description: "Crispy chicken sisig sizzling plate", price: 105, category: "Sizzling", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327" },
      { name: "Tokwa't Baboy", description: "Fried tofu and pork with vinegar dip", price: 79, category: "Appetizers", image: "https://images.unsplash.com/photo-1547592180-85f173990554" },
    ],
  },
  {
    name: "Mang Juan's Fried Chicken",
    description: "Crispy, juicy fried chicken and hearty combos the whole family loves.",
    vendorEmail: "vendor3@ehatid.com",
    category: "Fried Chicken",
    cuisine: "Fried Chicken",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 90,
    accentColor: "#D97706",
    image: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd",
    address: "22 Jupiter St, Brgy. Bel-Air, Makati",
    latitude: 14.5475,
    longitude: 121.0091,
    rating: 4.3,
    menu: [
      { name: "2pc Chicken Combo", description: "Two pieces with rice and a drink", price: 129, category: "Fried Chicken", image: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd", popular: true, addOns: [{ name: "Extra rice", price: 15 }, { name: "Gravy", price: 10 }] },
      { name: "Chicken Wings", description: "Six pieces of crispy wings", price: 110, category: "Fried Chicken", image: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd" },
      { name: "Chicken Sandwich", description: "Crispy fillet in a soft bun with mayo", price: 89, category: "Sandwiches", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd" },
      { name: "Loaded Fries", description: "Fries topped with cheese sauce, bacon and spring onion", price: 85, category: "Snacks", image: "https://images.unsplash.com/photo-1551782450-a2132b4ba21d", popular: true },
      { name: "Lemon Lime", description: "Fizzy citrus cooler", price: 35, category: "Drinks", image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93" },
    ],
  },
  {
    name: "Ninong's Lugaw",
    description: "Comforting rice porridge and lugaw, perfect for rainy days.",
    vendorEmail: "vendor3@ehatid.com",
    category: "Lugaw",
    cuisine: "Congee",
    deliveryTime: "15 - 20",
    deliveryFee: 0,
    minOrder: 75,
    accentColor: "#0D9488",
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
    address: "45 Shaw Blvd, Mandaluyong",
    latitude: 14.58,
    longitude: 121.0383,
    rating: 4.2,
    menu: [
      { name: "Plain Lugaw", description: "Warm rice porridge with ginger", price: 35, category: "Lugaw", image: "https://images.unsplash.com/photo-1547592166-23ac45744acd" },
      { name: "Chicken Lugaw", description: "Lugaw topped with shredded chicken and egg", price: 55, category: "Lugaw", image: "https://images.unsplash.com/photo-1547592166-23ac45744acd", popular: true, addOns: [{ name: "Hard-boiled egg", price: 15 }, { name: "Chicharon", price: 10 }] },
      { name: "Tokwa't Baboy", description: "Fried tofu and pork with vinegar dip", price: 80, category: "Appetizers", image: "https://images.unsplash.com/photo-1547592180-85f173990554" },
      { name: "Goto Lumpia", description: "Crispy pork lumpia rolls (5 pcs)", price: 40, category: "Snacks", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327" },
      { name: "Hot Tsokolate", description: "Thick tablea hot chocolate", price: 45, category: "Drinks", image: "https://images.unsplash.com/photo-1551024506-0bccd828d307", popular: true },
    ],
  },
  {
    name: "Reyna's Milk Tea",
    description: "Freshly brewed milk teas with pearls, pudding and creamy lattes.",
    vendorEmail: "vendor@ehatid.com",
    category: "Milk Tea",
    cuisine: "Milk Tea",
    deliveryTime: "15 - 20",
    deliveryFee: 25,
    minOrder: 50,
    accentColor: "#DB2777",
    image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699",
    address: "88 Maginhawa St, Quezon City",
    latitude: 14.6508,
    longitude: 121.0316,
    rating: 4.7,
    menu: [
      { name: "Classic Milk Tea", description: "Black tea with milk and chewy pearls", price: 59, category: "Milk Tea", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699", popular: true, options: [{ name: "Size", required: true, maxSelections: 1, choices: [{ name: "Medium", price: 0 }, { name: "Large", price: 15 }] }], addOns: [{ name: "Pearl", price: 10 }, { name: "Pudding", price: 12 }, { name: "Grass jelly", price: 10 }] },
      { name: "Taro Milk Tea", description: "Creamy taro blend with pearls", price: 69, category: "Milk Tea", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699", options: [{ name: "Size", required: true, maxSelections: 1, choices: [{ name: "Medium", price: 0 }, { name: "Large", price: 15 }] }] },
      { name: "Matcha Latte", description: "Stone-ground matcha with fresh milk", price: 85, category: "Milk Tea", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085" },
      { name: "Okinawa Milk Tea", description: "Brown sugar syrup, milk and pearls", price: 69, category: "Milk Tea", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699", popular: true },
      { name: "Wintermelon Milk Tea", description: "Roasted wintermelon with milk", price: 65, category: "Milk Tea", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699" },
    ],
  },
  {
    name: "Brew & Beans",
    description: "Specialty coffee and homemade pastries for slow afternoons.",
    vendorEmail: "vendor4@ehatid.com",
    category: "Coffee",
    cuisine: "Coffee & Pastries",
    deliveryTime: "15 - 20",
    deliveryFee: 30,
    minOrder: 60,
    accentColor: "#92400E",
    image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93",
    address: "G/F Ayala Ave cor Paseo de Roxas, Makati",
    latitude: 14.5547,
    longitude: 121.0239,
    rating: 4.5,
    menu: [
      { name: "Spanish Latte", description: "Double shot with sweet condensed milk", price: 85, category: "Coffee", image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93", popular: true },
      { name: "Barista Brew", description: "House blend drip coffee", price: 70, category: "Coffee", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085" },
      { name: "Iced Caramel Macchiato", description: "Espresso over milk and caramel", price: 95, category: "Coffee", image: "https://images.unsplash.com/photo-1544145945-f90425340c7e", popular: true, options: [{ name: "Size", required: true, maxSelections: 1, choices: [{ name: "Regular", price: 0 }, { name: "Large", price: 15 }] }] },
      { name: "Croissant", description: "Buttery flaky croissant", price: 55, category: "Pastries", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a" },
      { name: "Ube Cheesecake", description: "Creamy ube cheesecake slice", price: 85, category: "Pastries", image: "https://images.unsplash.com/photo-1565958011703-44f9829ba187" },
    ],
  },
  {
    name: "Isla Seafood Grill",
    description: "Fresh inihaw seafood straight from the market to your table.",
    vendorEmail: "vendor4@ehatid.com",
    category: "Seafood",
    cuisine: "Grilled",
    deliveryTime: "25 - 35",
    deliveryFee: 45,
    minOrder: 120,
    accentColor: "#0284C7",
    image: "https://images.unsplash.com/photo-1467003909585-2f8a72700288",
    address: "Sea Breeze Market, Seaside Blvd, Pasay",
    latitude: 14.5212,
    longitude: 121.0095,
    rating: 4.7,
    isNew: true,
    menu: [
      { name: "Grilled Prawns", description: "Butter-garlic grilled prawns (5 pcs)", price: 180, category: "Grilled", image: "https://images.unsplash.com/photo-1467003909585-2f8a72700288", popular: true, addOns: [{ name: "Extra rice", price: 15 }] },
      { name: "Sinuglaw", description: "Grilled pork belly with kinilaw tuna", price: 135, category: "Filipino", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
      { name: "Grilled Squid", description: "Charred squid stuffed and grilled", price: 150, category: "Grilled", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327", popular: true },
      { name: "Inihaw na Tuna", description: "Thick grilled yellowfin tuna steak", price: 165, category: "Grilled", image: "https://images.unsplash.com/photo-1467003909585-2f8a72700288" },
      { name: "Garlic Butter Rice", description: "Warm garlic buttered rice", price: 30, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
    ],
  },
  {
    name: "Hapag Pancitan",
    description: "Guisado pancit and lumpia, the way Nanay makes it.",
    vendorEmail: "vendor4@ehatid.com",
    category: "Noodles",
    cuisine: "Pancit",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 90,
    accentColor: "#B45309",
    image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061",
    address: "678 España Blvd, Sampaloc, Manila",
    latitude: 14.6095,
    longitude: 120.9883,
    rating: 4.3,
    menu: [
      { name: "Pancit Bihon Guisado", description: "Rice noodles sauteed with veggies and chicken", price: 110, category: "Noodles", image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061", popular: true },
      { name: "Pancit Canton", description: "Egg noodles with pork and shrimp", price: 125, category: "Noodles", image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061" },
      { name: "Bihon + Canton Mix", description: "Half bihon, half canton, best of both", price: 135, category: "Noodles", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
      { name: "Lumpiang Shanghai", description: "Crispy pork spring rolls (10 pcs)", price: 55, category: "Street Food", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327", popular: true, addOns: [{ name: "Extra 5 pcs", price: 40 }] },
      { name: "Rice", description: "Steamed jasmine rice", price: 20, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
    ],
  },
  {
    name: "Lola Anda's Kusina",
    description: "Slow-cooked Filipino ulam and home-style rice meals from Lola Anda's kitchen.",
    vendorEmail: "vendor5@ehatid.com",
    category: "Filipino",
    cuisine: "Home-cooked",
    deliveryTime: "25 - 40",
    deliveryFee: 45,
    minOrder: 120,
    accentColor: "#059669",
    image: "https://images.unsplash.com/photo-1547592180-85f173990554",
    address: "15-B K-1st St, Kamuning, Quezon City",
    latitude: 14.6291,
    longitude: 121.0463,
    rating: 4.6,
    menu: [
      { name: "Chicken Adobo Rice Meal", description: "Savory soy-vinegar chicken adobo over rice", price: 105, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe", popular: true, addOns: [{ name: "Extra rice", price: 15 }] },
      { name: "Kare-Kare", description: "Peanut stew with oxtail and vegetables", price: 140, category: "Filipino", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19", popular: true },
      { name: "Sinigang na Baboy", description: "Sour tamarind soup with pork and kangkong", price: 130, category: "Filipino", image: "https://images.unsplash.com/photo-1547592166-23ac45744acd" },
      { name: "Pinakbet", description: "Mixed vegetables with bagoong and pork", price: 95, category: "Filipino", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c" },
      { name: "Lechon Kawali", description: "Crispy deep-fried pork belly", price: 150, category: "Filipino", image: "https://images.unsplash.com/photo-1544025162-d76694265947", popular: true },
      { name: "Mango Shake", description: "Fresh ripe mango blended cold", price: 45, category: "Drinks", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699" },
    ],
  },
  {
    name: "Tatay's Lechon",
    description: "Crackling lechon kawali and crispy pata, served with lechon sauce.",
    vendorEmail: "vendor5@ehatid.com",
    category: "Lechon",
    cuisine: "Roast",
    deliveryTime: "25 - 35",
    deliveryFee: 45,
    minOrder: 100,
    accentColor: "#DC2626",
    image: "https://images.unsplash.com/photo-1544025162-d76694265947",
    address: "2nd Ave, Grace Park, Caloocan",
    latitude: 14.6556,
    longitude: 120.9766,
    rating: 4.4,
    menu: [
      { name: "Lechon Kawali", description: "Crackling pork belly with lechon sauce", price: 149, category: "Lechon", image: "https://images.unsplash.com/photo-1544025162-d76694265947", popular: true, addOns: [{ name: "Extra lechon sauce", price: 10 }, { name: "Extra rice", price: 15 }] },
      { name: "Lechon Paksiw", description: "Pork belly simmered in vinegar and atsuete", price: 120, category: "Lechon", image: "https://images.unsplash.com/photo-1544025162-d76694265947" },
      { name: "Crispy Pata Piece", description: "Deep-fried crispy pork hock portion", price: 180, category: "Lechon", image: "https://images.unsplash.com/photo-1544025162-d76694265947", popular: true },
      { name: "Garlic Rice", description: "Warm garlic fried rice", price: 25, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
    ],
  },
  {
    name: "Dampa Dimsum",
    description: "Steamed siomai, dumplings and Chinese classics every lunchtime.",
    vendorEmail: "vendor6@ehatid.com",
    category: "Dimsum",
    cuisine: "Chinese",
    deliveryTime: "15 - 20",
    deliveryFee: 25,
    minOrder: 75,
    accentColor: "#B45309",
    image: "https://images.unsplash.com/photo-1563245372-f21724e3856d",
    address: "Sct. Limbaga St, Diliman, Quezon City",
    latitude: 14.6414,
    longitude: 121.0305,
    rating: 4.4,
    isNew: true,
    menu: [
      { name: "Steamed Siomai (4 pcs)", description: "Pork and shrimp siomai with dip", price: 45, category: "Dimsum", image: "https://images.unsplash.com/photo-1563245372-f21724e3856d", popular: true, addOns: [{ name: "Chili oil", price: 5 }] },
      { name: "Pork Dumplings (3 pcs)", description: "Hand-folded pan-fried dumplings", price: 65, category: "Dimsum", image: "https://images.unsplash.com/photo-1555126634-323283e090fa" },
      { name: "Xiao Long Bao (4 pcs)", description: "Soup-filled steamed buns", price: 95, category: "Dimsum", image: "https://images.unsplash.com/photo-1563245372-f21724e3856d", popular: true },
      { name: "Hainanese Chicken Rice", description: "Poached chicken with oiled rice", price: 120, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe" },
      { name: "Asado Siopao", description: "Steamed bun with sweet pork filling", price: 40, category: "Dimsum", image: "https://images.unsplash.com/photo-1563245372-f21724e3856d" },
    ],
  },
  {
    name: "Krispy Fried Treats",
    description: "Crispy snacks and loaded fries to satisfy every craving.",
    vendorEmail: "vendor6@ehatid.com",
    category: "Snacks",
    cuisine: "Street Food",
    deliveryTime: "15 - 20",
    deliveryFee: 0,
    minOrder: 60,
    accentColor: "#EAB308",
    image: "https://images.unsplash.com/photo-1551782450-a2132b4ba21d",
    address: "12 Libis Town Center East, Quezon City",
    latitude: 14.6131,
    longitude: 121.0716,
    rating: 4.1,
    isNew: true,
    menu: [
      { name: "Mama's Fries", description: "Golden fries with your choice of topping", price: 55, category: "Snacks", image: "https://images.unsplash.com/photo-1551782450-a2132b4ba21d", popular: true, addOns: [{ name: "Cheese", price: 15 }, { name: "Gravy", price: 10 }, { name: "Bacon bits", price: 20 }] },
      { name: "Onion Rings", description: "Crispy battered onion rings", price: 60, category: "Snacks", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327" },
      { name: "Chicharon Bulaklak", description: "Crispy pork ruffle fat, best with vinegar", price: 85, category: "Snacks", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe", popular: true },
      { name: "Loaded Nachos", description: "Tortilla chips with cheese, salsa and jalapeño", price: 95, category: "Snacks", image: "https://images.unsplash.com/photo-1551782450-a2132b4ba21d" },
      { name: "Iced Tea", description: "Cold brewed iced tea", price: 30, category: "Drinks", image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93" },
    ],
  },
  {
    name: "Tavern Burgers",
    description: "Classic American-style burgers with Filipino flair.",
    vendorEmail: "vendor3@ehatid.com",
    category: "Burgers",
    cuisine: "Fast Food",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 90,
    accentColor: "#B45309",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd",
    address: "Luxury Bldg, QC Ave, Novaliches, Quezon City",
    latitude: 14.651,
    longitude: 121.0298,
    rating: 4.2,
    menu: [
      { name: "Classic Tavern Burger", description: "100% beef patty, lettuce, tomato and special sauce", price: 99, category: "Burgers", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd", popular: true, options: [{ name: "Patty", required: false, maxSelections: 1, choices: [{ name: "Beef", price: 0 }, { name: "Chicken", price: 0 }] }], addOns: [{ name: "Extra patty", price: 50 }, { name: "Cheese", price: 15 }, { name: "Bacon", price: 25 }] },
      { name: "Double Cheese Burger", description: "Two patties, double cheese", price: 139, category: "Burgers", image: "https://images.unsplash.com/photo-1550547660-d9450f859349" },
      { name: "Spicy Sizzling Burger", description: "Juicy patty with sizzling spicy sauce and onion", price: 129, category: "Burgers", image: "https://images.unsplash.com/photo-1550547660-d9450f859349" },
      { name: "Burger Steak Rice Meal", description: "Beef patty smothered in mushroom gravy over rice", price: 115, category: "Rice Meals", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19" },
      { name: "Fries", description: "Salted shoestring fries", price: 45, category: "Snacks", image: "https://images.unsplash.com/photo-1551782450-a2132b4ba21d" },
    ],
  },
  {
    name: "Sizzling Sarap",
    description: "Sizzling plates, bulalo and rice meals with serious sarap.",
    vendorEmail: "vendor2@ehatid.com",
    category: "Sizzling",
    cuisine: "Ihaw-Ihaw",
    deliveryTime: "20 - 30",
    deliveryFee: 35,
    minOrder: 80,
    accentColor: "#DC2626",
    image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327",
    address: "Poblacion, Makati",
    latitude: 14.5653,
    longitude: 121.0263,
    rating: 4.6,
    isNew: true,
    menu: [
      { name: "Sizzling Sisig Plate", description: "Pork sisig to order on a sizzling plate", price: 99, category: "Sizzling", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe", popular: true, addOns: [{ name: "Extra rice", price: 15 }] },
      { name: "Sizzling Chicken", description: "Buttered garlic chicken on a sizzling plate", price: 110, category: "Sizzling", image: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327" },
      { name: "Bulalo", description: "Beef shank marrow soup", price: 145, category: "Filipino", image: "https://images.unsplash.com/photo-1547592166-23ac45744acd" },
      { name: "Bagoong Rice", description: "Garlic fried rice with shrimp paste and mango", price: 65, category: "Rice Meals", image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe", popular: true },
      { name: "Sago't Gulaman", description: "Sweet sago and gulaman iced drink", price: 30, category: "Drinks", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699" },
    ],
  },
];

const VENDORS: Array<{ email: string; name: string }> = [
  { email: "vendor@ehatid.com", name: "Maria Santos" },
  { email: "vendor2@ehatid.com", name: "Ben Aguilar" },
  { email: "vendor3@ehatid.com", name: "Juan Mendoza" },
  { email: "vendor4@ehatid.com", name: "Reyna Villanueva" },
  { email: "vendor5@ehatid.com", name: "Lola Anda Ramos" },
  { email: "vendor6@ehatid.com", name: "Tatay Pabling Cruz" },
];

async function seed(): Promise<void> {
  await connectToDatabase();
  console.log("Resetting database...");

  await Promise.all([
    UserModel.deleteMany({}),
    StallModel.deleteMany({}),
    OrderModel.deleteMany({}),
    ReviewModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    ApplicationModel.deleteMany({}),
    OtpRequestModel.deleteMany({}),
    RiderLocationModel.deleteMany({}),
    RiderModel.deleteMany({}),
    RiderReviewModel.deleteMany({}),
    ConfigModel.deleteMany({}),
  ]);

  console.log("Importing E-Hatid demo data...\n");
  const uid = makeIdFactory();

  // Accounts
  await upsertUser({
    email: env.masterAdminEmail,
    name: "E-Hatid Admin",
    roles: ["customer", "vendor", "rider", "admin"],
    roleStatus: { customer: "approved", vendor: "approved", rider: "approved", admin: "approved" },
    isMasterAdmin: true,
  });
  await upsertUser({
    email: "customer@ehatid.com",
    name: "Juan Dela Cruz",
    roles: ["customer"],
    roleStatus: { customer: "approved", rider: "none", vendor: "none", admin: "none" },
    phone: "09171234567",
  });
  for (const vendor of VENDORS) {
    const firstStall = STALLS.find((s) => s.vendorEmail === vendor.email);
    await upsertUser({
      email: vendor.email,
      name: vendor.name,
      roles: ["customer", "vendor"],
      roleStatus: { customer: "approved", vendor: "approved", rider: "none", admin: "none" },
      stallName: firstStall?.name ?? "",
    });
  }
  await upsertUser({
    email: "rider@ehatid.com",
    name: "Rider Pedro",
    roles: ["customer", "rider"],
    roleStatus: { customer: "approved", rider: "approved", vendor: "none", admin: "none" },
    vehicle: "motorcycle",
    licensePlate: "XYZ-123",
  });

  // Vendor id lookup
  const vendorUsers = await UserModel.find({ email: { $in: VENDORS.map((v) => v.email) } })
    .select("email _id")
    .lean();
  const vendorIdByEmail = new Map(vendorUsers.map((v) => [v.email, String(v._id)]));

  // Stalls
  for (const s of STALLS) {
    const vendorId = vendorIdByEmail.get(s.vendorEmail) ?? "vendor";
    const menu = s.menu.map((item) => ({
      id: `item-${uid()}`,
      name: item.name,
      description: item.description,
      price: item.price,
      image: item.image,
      category: item.category,
      available: true,
      popular: item.popular ?? false,
      stallId: "",
      options:
        item.options?.map((o) => ({
          id: `opt-${uid()}`,
          name: o.name,
          required: o.required,
          maxSelections: o.maxSelections,
          choices: o.choices.map((c) => ({ id: `ch-${uid()}`, name: c.name, price: c.price })),
        })) ?? [],
      addOns:
        item.addOns?.map((a) => ({ id: `add-${uid()}`, name: a.name, price: a.price })) ?? [],
    }));
    await StallModel.findOneAndUpdate(
      { name: s.name },
      {
        $set: {
          name: s.name,
          description: s.description,
          image: s.image,
          logo: "",
          rating: s.rating,
          deliveryTime: s.deliveryTime,
          deliveryFee: s.deliveryFee,
          minOrder: s.minOrder,
          vendorId,
          category: s.category,
          cuisine: s.cuisine,
          accentColor: s.accentColor,
          active: true,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          isNew: s.isNew ?? false,
          menu,
        },
      },
      { upsert: true, new: true },
    );
  }

  // Delivery config defaults
  await ConfigModel.findOneAndUpdate(
    { key: "delivery" },
    { $setOnInsert: { perKmRate: 30, gasPrice: 60, kmPerLiter: 40, bonus: 0 } },
    { upsert: true, new: true },
  );

  const stallCount = await StallModel.countDocuments();
  const menuCount = await StallModel.aggregate([{ $project: { n: { $size: "$menu" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]);
  const totalMenu = (menuCount[0]?.total as number) ?? 0;

  console.log("Seed complete.");
  console.log(`Imported ${stallCount} stalls with ${totalMenu} menu items.`);
  console.log("Demo accounts (password: password123):");
  console.log(`  ${env.masterAdminEmail}  (master admin)`);
  console.log("  customer@ehatid.com");
  console.log("  rider@ehatid.com");
  console.log(`  ${VENDORS.map((v) => v.email).join(", ")}`);

  await disconnectFromDatabase();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});