const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const { verifyTirthManager } = require("../../middlewares/tirthBookingAccess");

const {
  getTirthRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updatePropertyInfo,
} = require("../../controller/TirthControllers/Tirthroomcontroller");

const {
  createBooking,
  getMyBookings,
  cancelBooking,
  getBookingDetails,
  getTirthBookings,
  updateBookingStatus,
} = require("../../controller/TirthControllers/Tirthbookingcontroller");

const {
  getAccounting,
  addAccountingEntry,
  updateAccountingEntry,
  deleteAccountingEntry,
} = require("../../controller/TirthControllers/Tirthaccountingcontroller");

const {
  getTirthOverview,
} = require("../../controller/TirthControllers/Tirthdashboardcontroller");

const {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} = require("../../controller/TirthControllers/tirthEmployeeController");

const {
  getAttendanceByDate,
  markAttendance,
  getMonthlyReport,
} = require("../../controller/TirthControllers/tirthAttendanceController");

const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  addMovement,
  getMovements,
} = require("../../controller/TirthControllers/tirthInventoryController");

const {
  getManageAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = require("../../controller/TirthControllers/tirthAnnouncementController");

const {
  getTirthComplaints,
  respondToComplaint,
  markReadByTirth,
} = require("../../controller/TirthControllers/tirthComplaintController");

const {
  getManagePujaTypes,
  createPujaType,
  updatePujaType,
  deletePujaType,
  getTirthPujaBookings,
  updatePujaBookingStatus,
} = require("../../controller/TirthControllers/tirthPujaController");

const {
  getTirthDonations,
} = require("../../controller/TirthControllers/tirthDonationController");

const {
  getTirthDashboard,
} = require("../../controller/TirthControllers/tirthDashboardV2Controller");

const {
  recordSalaryExpense,
  getAccountingReport,
} = require("../../controller/TirthControllers/tirthAccountingAutoController");

const {
  getBhojanSettings,
  updateBhojanSettings,
  getManageMenu,
  saveMenu,
  deleteMenu,
  getTirthFoodOrders,
  updateFoodOrderStatus,
} = require("../../controller/TirthControllers/tirthBhojanController");

/* ==================================================================
   PUBLIC ROUTES
================================================================== */

// Tirthbook.jsx — room types + availability (checkIn/checkOut optional query)
router.get("/rooms/:tirthId", getTirthRooms);

/* ==================================================================
   PROTECTED ROUTES
================================================================== */
router.use(authMiddleware);

/* ---------------- USER SIDE ---------------- */

// Tirthbook.jsx — booking request bhejna
router.post("/book/:tirthId", createBooking);

// MyBookings.jsx — apni bookings
router.get("/my-bookings", getMyBookings);

// booking detail
router.get("/detail/:bookingId", getBookingDetails);

// MyBookings.jsx — cancel
router.put("/cancel/:bookingId", cancelBooking);

// ManageOverview.jsx — poora dashboard
router.get("/manage/:tirthId/dashboard", verifyTirthManager, getTirthDashboard);

/* ---------------- MANAGER SIDE ---------------- */

// ManageOverview.jsx
router.get("/manage/:tirthId/overview", verifyTirthManager, getTirthOverview);

// ManageRooms.jsx
router.post("/manage/:tirthId/rooms", verifyTirthManager, createRoom);
router.put(
  "/manage/:tirthId/property-info",
  verifyTirthManager,
  updatePropertyInfo,
);
router.put("/manage/rooms/:roomId", updateRoom); // permission check controller ke andar
router.delete("/manage/rooms/:roomId", deleteRoom); // permission check controller ke andar

// ManageBookings.jsx
router.get("/manage/:tirthId/bookings", verifyTirthManager, getTirthBookings);
router.put("/manage/booking/:bookingId/status", updateBookingStatus); // check controller ke andar

// ManageAccounting.jsx
router.get("/manage/:tirthId/accounting", verifyTirthManager, getAccounting);
router.post(
  "/manage/:tirthId/accounting",
  verifyTirthManager,
  addAccountingEntry,
);
router.put("/manage/accounting/:entryId", updateAccountingEntry); // check controller ke andar
router.delete("/manage/accounting/:entryId", deleteAccountingEntry); // check controller ke andar

// ManageEmployees.jsx
router.get("/manage/:tirthId/employees", verifyTirthManager, getEmployees);
router.post("/manage/:tirthId/employees", verifyTirthManager, createEmployee);
router.put("/manage/employees/:employeeId", updateEmployee); // check controller ke andar
router.delete("/manage/employees/:employeeId", deleteEmployee); // check controller ke andar

// ManageEmployees.jsx — Attendance
router.get(
  "/manage/:tirthId/attendance/report",
  verifyTirthManager,
  getMonthlyReport,
);
router.get(
  "/manage/:tirthId/attendance",
  verifyTirthManager,
  getAttendanceByDate,
);
router.post("/manage/:tirthId/attendance", verifyTirthManager, markAttendance);

// ManageInventory.jsx — categories
router.get(
  "/manage/:tirthId/inventory/categories",
  verifyTirthManager,
  getCategories,
);
router.post(
  "/manage/:tirthId/inventory/categories",
  verifyTirthManager,
  createCategory,
);
router.put("/manage/inventory/categories/:categoryId", updateCategory);
router.delete("/manage/inventory/categories/:categoryId", deleteCategory);

// ManageInventory.jsx — items
router.get("/manage/:tirthId/inventory/items", verifyTirthManager, getItems);
router.post("/manage/:tirthId/inventory/items", verifyTirthManager, createItem);
router.put("/manage/inventory/items/:itemId", updateItem);
router.delete("/manage/inventory/items/:itemId", deleteItem);

// ManageInventory.jsx — stock movements
router.post("/manage/inventory/items/:itemId/movement", addMovement);
router.get(
  "/manage/:tirthId/inventory/movements",
  verifyTirthManager,
  getMovements,
);

// ManageAnnouncements.jsx
router.get(
  "/manage/:tirthId/announcements",
  verifyTirthManager,
  getManageAnnouncements,
);
router.post(
  "/manage/:tirthId/announcements",
  verifyTirthManager,
  createAnnouncement,
);
router.put("/manage/announcements/:announcementId", updateAnnouncement);
router.delete("/manage/announcements/:announcementId", deleteAnnouncement);

// ManageComplaints.jsx
router.get(
  "/manage/:tirthId/complaints",
  verifyTirthManager,
  getTirthComplaints,
);
router.put("/manage/complaints/:complaintId", respondToComplaint);
router.patch("/manage/complaints/:complaintId/read", markReadByTirth);

// ManagePuja.jsx
router.get(
  "/manage/:tirthId/puja-types",
  verifyTirthManager,
  getManagePujaTypes,
);
router.post("/manage/:tirthId/puja-types", verifyTirthManager, createPujaType);
router.put("/manage/puja-types/:pujaTypeId", updatePujaType);
router.delete("/manage/puja-types/:pujaTypeId", deletePujaType);

router.get(
  "/manage/:tirthId/puja-bookings",
  verifyTirthManager,
  getTirthPujaBookings,
);
router.put("/manage/puja-bookings/:bookingId/status", updatePujaBookingStatus);

// ManageDonations.jsx
router.get("/manage/:tirthId/donations", verifyTirthManager, getTirthDonations);

// ManageAccounting.jsx
router.get(
  "/manage/:tirthId/accounting/report",
  verifyTirthManager,
  getAccountingReport,
);
router.post(
  "/manage/:tirthId/accounting/salary",
  verifyTirthManager,
  recordSalaryExpense,
);

// ManageBhojan.jsx
router.get(
  "/manage/:tirthId/bhojan/settings",
  verifyTirthManager,
  getBhojanSettings,
);
router.put(
  "/manage/:tirthId/bhojan/settings",
  verifyTirthManager,
  updateBhojanSettings,
);

router.get("/manage/:tirthId/bhojan/menu", verifyTirthManager, getManageMenu);
router.put("/manage/:tirthId/bhojan/menu", verifyTirthManager, saveMenu);
router.delete("/manage/bhojan/menu/:menuId", deleteMenu);

router.get(
  "/manage/:tirthId/bhojan/orders",
  verifyTirthManager,
  getTirthFoodOrders,
);
router.put("/manage/bhojan/orders/:orderId/status", updateFoodOrderStatus);

module.exports = router;
