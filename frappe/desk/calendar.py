# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import json

import frappe
from frappe import _
from datetime import datetime, time, timedelta
from frappe.utils import get_datetime, add_days, cint


@frappe.whitelist()
def update_event(args, field_map):

    frappe.flags.from_calendar_drag = True

    try:
        args = frappe._dict(json.loads(args))
        field_map = frappe._dict(json.loads(field_map))

        doc = frappe.get_doc(args.doctype, args.name)

        old_start = get_datetime(doc.get(field_map.start))
        old_end   = get_datetime(doc.get(field_map.end)) if doc.get(field_map.end) else None

        new_start = get_datetime(args.get(field_map.start))
        new_end   = get_datetime(args.get(field_map.end)) if args.get(field_map.end) else None

        if not old_start or not new_start:
            return

        # -----------------------------
        # Preserve time, change date
        # -----------------------------
        start_dt = datetime.combine(
            new_start.date(),
            old_start.time()
        )
        doc.set(field_map.start, start_dt)

        # -----------------------------
        # END DATE HANDLING (IMPORTANT)
        # -----------------------------
        if old_end:

            is_all_day = cint(args.get("allDay")) == 1

            # 🔥 Case 1: Single-day drag (end missing or invalid)
            if not new_end or new_end <= new_start:
                end_dt = start_dt + timedelta(minutes=1)

            # 🔥 Case 2: All-day or FullCalendar exclusive end
            elif is_all_day or new_end.time() == time(0, 0):
                end_dt = datetime.combine(
                    add_days(new_end.date(), -1),
                    old_end.time()
                )

            # 🔥 Case 3: Normal timed event
            else:
                end_dt = datetime.combine(
                    new_end.date(),
                    old_end.time()
                )

            doc.set(field_map.end, end_dt)

        doc.save(ignore_permissions=True)

    finally: 
        frappe.flags.from_calendar_drag = False


def get_event_conditions(doctype, filters=None):
	"""Return SQL conditions with user permissions and filters for event queries."""
	from frappe.desk.reportview import get_filters_cond

	if not frappe.has_permission(doctype):
		frappe.throw(_("Not Permitted"), frappe.PermissionError)

	return get_filters_cond(doctype, filters, [], with_match_conditions=True)


@frappe.whitelist()
def get_events(doctype, start, end, field_map, filters=None, fields=None):
	field_map = frappe._dict(json.loads(field_map))
	fields = frappe.parse_json(fields)

	doc_meta = frappe.get_meta(doctype)
	for d in doc_meta.fields:
		if d.fieldtype == "Color":
			field_map.update({"color": d.fieldname})

	filters = json.loads(filters) if filters else []

	if not fields:
		fields = [field_map.start, field_map.end, field_map.title, "name", "priority", "status"]

	if field_map.color:
		fields.append(field_map.color)

	start_date = "ifnull({}, '0001-01-01 00:00:00')".format(field_map.start)
	end_date = "ifnull({}, '2199-12-31 00:00:00')".format(field_map.end)

	filters += [
		[doctype, start_date, "<=", end],
		[doctype, end_date, ">=", start],
	]
	fields = list({field for field in fields if field})
	return frappe.get_list(doctype, fields=fields, filters=filters)
