const ShiftRemittance = require('../models/ShiftRemittance');
const User = require('../models/User');

const checkOverdueRemittances = async (io) => {
  try {
    const now = new Date();

    // 1. T+12h Warning Notification
    // where shift_ended_at + 12h < now AND overdue_notified_driver_at is null
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const onesToWarn = await ShiftRemittance.find({
      status: 'not_submitted',
      shift_ended_at: { $lte: twelveHoursAgo },
      overdue_notified_driver_at: null,
    });

    for (const r of onesToWarn) {
      r.overdue_notified_driver_at = now;
      await r.save();

      io.to(`user:${r.driverId}`).emit('notification', {
        title: 'Remittance Reminder',
        body: '12 hours have passed since your shift ended. Please submit your remittance before it becomes overdue.',
        type: 'remittance_warning',
        remittanceId: r._id,
      });
    }

    // 2. T+24h Overdue escalation
    // where status === 'not_submitted' AND deadline_at < now
    const onesOverdue = await ShiftRemittance.find({
      status: 'not_submitted',
      deadline_at: { $lte: now },
    });

    for (const r of onesOverdue) {
      r.status = 'overdue';
      await r.save();

      io.to(`user:${r.driverId}`).emit('notification', {
        title: 'Remittance Overdue',
        body: 'Your remittance is now overdue and an admin has been notified.',
        type: 'remittance_overdue',
        remittanceId: r._id,
      });

      io.to(`community:${r.communityId}`).emit('notification', {
        title: 'Overdue Remittance',
        body: `A driver has failed to submit remittance within 24 hours.`,
        type: 'admin_alert',
        remittanceId: r._id,
      });
    }

    // 3. T+48h Escalation
    // where status === 'overdue' AND shift_ended_at < now - 48h
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const onesToEscalate = await ShiftRemittance.find({
      status: 'overdue',
      shift_ended_at: { $lte: fortyEightHoursAgo },
      escalated_at: null,
    });

    for (const r of onesToEscalate) {
      r.status = 'escalated';
      r.escalated_at = now;
      await r.save();

      io.to(`community:${r.communityId}`).emit('notification', {
        title: 'Escalated Remittance',
        body: `A remittance has been overdue for > 48h and is now escalated.`,
        type: 'admin_alert',
        remittanceId: r._id,
      });
      
      io.to(`user:${r.driverId}`).emit('notification', {
        title: 'Remittance Escalated',
        body: 'Your remittance has been escalated to management due to failure to submit.',
        type: 'remittance_escalated',
        remittanceId: r._id,
      });
    }

  } catch (err) {
    console.error('Error running remittance enforcement job', err);
  }
};

const startRemittanceEnforcementJob = (io) => {
  // Run every hour
  setInterval(() => {
    checkOverdueRemittances(io);
  }, 60 * 60 * 1000);

  // Run shortly after startup
  setTimeout(() => {
    checkOverdueRemittances(io);
  }, 10 * 1000);
};

module.exports = { startRemittanceEnforcementJob, checkOverdueRemittances };
