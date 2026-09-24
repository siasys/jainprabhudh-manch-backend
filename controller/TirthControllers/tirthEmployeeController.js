const mongoose = require("mongoose");
const TirthEmployee = require("../../model/TirthModels/tirthEmployeeModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

const ROLES = [
  "pujari",
  "manager",
  "cook",
  "cleaner",
  "guard",
  "gardener",
  "accountant",
  "helper",
  "other",
];

/* 'YYYY-MM-DD' -> UTC midnight (timezone se date shift na ho) */
const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * ManageEmployees.jsx — list + stats
 * GET /api/tirth-booking/manage/:tirthId/employees?role=&employmentStatus=&search=&page=&limit=
 */
const getEmployees = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { role, employmentStatus, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 100);

    const query = { tirthId, status: "active" };
    if (role && role !== "all") query.role = role;
    if (employmentStatus && employmentStatus !== "all") {
      query.employmentStatus = employmentStatus;
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ name: rx }, { phone: rx }, { roleOther: rx }];
    }

    const [employees, total, agg] = await Promise.all([
      TirthEmployee.find(query)
        .sort({ employmentStatus: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthEmployee.countDocuments(query),
      // stats hamesha poore tirth ke (filter se independent)
      TirthEmployee.aggregate([
        {
          $match: {
            tirthId: new mongoose.Types.ObjectId(String(tirthId)),
            status: "active",
          },
        },
        {
          $group: {
            _id: "$employmentStatus",
            count: { $sum: 1 },
            salary: { $sum: "$salary" },
          },
        },
      ]),
    ]);

    const stats = {
      totalEmployees: 0,
      activeEmployees: 0,
      leftEmployees: 0,
      monthlySalary: 0, // sirf active staff ka
    };

    agg.forEach((row) => {
      const count = Number(row.count) || 0;
      stats.totalEmployees += count;
      if (row._id === "active") {
        stats.activeEmployees = count;
        stats.monthlySalary = Number(row.salary) || 0;
      }
      if (row._id === "left") stats.leftEmployees = count;
    });

    // role-wise count (chips ke liye)
    const roleCounts = {};
    employees.forEach((e) => {
      roleCounts[e.role] = (roleCounts[e.role] || 0) + 1;
    });

    return successResponse(res, {
      employees: employees.map((e) => ({ ...e, id: String(e._id) })),
      stats,
      roleCounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("❌ getEmployees error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageEmployees.jsx — add employee
 * POST /api/tirth-booking/manage/:tirthId/employees
 */
const createEmployee = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const {
      name,
      phone,
      role,
      roleOther,
      salary,
      joinDate,
      photo,
      address,
      aadhar,
      emergencyName,
      emergencyPhone,
      note,
    } = req.body;

    if (!name || !String(name).trim()) {
      return errorResponse(res, "Employee name is required", 400);
    }
    if (!phone || String(phone).replace(/\D/g, "").length < 10) {
      return errorResponse(res, "Valid 10-digit phone number is required", 400);
    }

    const jd = toDay(joinDate);
    if (!jd) return errorResponse(res, "Valid join date is required", 400);

    const cleanRole = ROLES.includes(role) ? role : "other";

    const employee = await TirthEmployee.create({
      tirthId,
      name: String(name).trim(),
      phone: String(phone).trim(),
      role: cleanRole,
      roleOther: cleanRole === "other" ? String(roleOther || "").trim() : "",
      salary: Number(salary) || 0,
      joinDate: jd,
      photo: photo || "",
      address: address || "",
      aadhar: aadhar || "",
      emergencyName: emergencyName || "",
      emergencyPhone: emergencyPhone || "",
      note: note || "",
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Employee added successfully",
      employee,
    });
  } catch (error) {
    console.error("❌ createEmployee error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageEmployees.jsx — update employee
 * PUT /api/tirth-booking/manage/employees/:employeeId
 */
const updateEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await TirthEmployee.findById(employeeId);
    if (!employee || employee.status === "deleted") {
      return errorResponse(res, "Employee not found", 404);
    }

    if (!isUserTirthManager(req.user, employee.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const {
      name,
      phone,
      role,
      roleOther,
      salary,
      joinDate,
      photo,
      address,
      aadhar,
      emergencyName,
      emergencyPhone,
      note,
      employmentStatus,
      leaveDate,
    } = req.body;

    if (name !== undefined) employee.name = String(name).trim();
    if (phone !== undefined) employee.phone = String(phone).trim();

    if (role !== undefined) {
      employee.role = ROLES.includes(role) ? role : "other";
      // role badal ke "other" se hat gaya to purana text saaf kar do
      if (employee.role !== "other") employee.roleOther = "";
    }
    if (roleOther !== undefined && employee.role === "other") {
      employee.roleOther = String(roleOther).trim();
    }

    if (salary !== undefined) employee.salary = Number(salary) || 0;

    if (joinDate !== undefined) {
      const jd = toDay(joinDate);
      if (!jd) return errorResponse(res, "Valid join date is required", 400);
      employee.joinDate = jd;
    }

    if (photo !== undefined) employee.photo = photo;
    if (address !== undefined) employee.address = address;
    if (aadhar !== undefined) employee.aadhar = aadhar;
    if (emergencyName !== undefined) employee.emergencyName = emergencyName;
    if (emergencyPhone !== undefined) employee.emergencyPhone = emergencyPhone;
    if (note !== undefined) employee.note = note;

    if (
      employmentStatus !== undefined &&
      ["active", "left"].includes(employmentStatus)
    ) {
      employee.employmentStatus = employmentStatus;
      // wapas active kiya to leaving date hata do
      if (employmentStatus === "active") employee.leaveDate = null;
    }

    if (leaveDate !== undefined) {
      employee.leaveDate = leaveDate ? toDay(leaveDate) : null;
    }

    await employee.save();

    return successResponse(res, {
      message: "Employee updated successfully",
      employee,
    });
  } catch (error) {
    console.error("❌ updateEmployee error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageEmployees.jsx — delete employee (soft delete)
 * DELETE /api/tirth-booking/manage/employees/:employeeId
 */
const deleteEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await TirthEmployee.findById(employeeId);
    if (!employee || employee.status === "deleted") {
      return errorResponse(res, "Employee not found", 404);
    }

    if (!isUserTirthManager(req.user, employee.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    employee.status = "deleted";
    await employee.save();

    return successResponse(res, { message: "Employee deleted successfully" });
  } catch (error) {
    console.error("❌ deleteEmployee error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  ROLES,
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
};
